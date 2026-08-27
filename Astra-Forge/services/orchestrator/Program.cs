using System.Collections.Concurrent;
using System.Diagnostics;

var visionUrl = Environment.GetEnvironmentVariable("VISION_SERVICE_URL") ?? "http://localhost:5001";
var geometryCli = Environment.GetEnvironmentVariable("ASTRAFORGE_GEOMETRY_CLI")
                 ?? (OperatingSystem.IsWindows() ? "astraforge_cli.exe" : "astraforge_cli");
var urls = Environment.GetEnvironmentVariable("ASPNETCORE_URLS") ?? "http://localhost:5003";

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHttpClient("vision", c => c.Timeout = TimeSpan.FromSeconds(60));
builder.Logging.AddConsole();
builder.WebHost.UseUrls(urls);
var app = builder.Build();

var jobs = new ConcurrentDictionary<string, PipelineJob>();
var logger = app.Logger;

app.MapGet("/health", () => Results.Ok(new { ok = true, service = "astraforge-orchestrator", version = "0.2.0", visionUrl, geometryCli }));
app.MapGet("/api/jobs", () => Results.Ok(jobs.Values.OrderByDescending(j => j.CreatedAt)));
app.MapGet("/api/jobs/{id}", (string id) => jobs.TryGetValue(id, out var job) ? Results.Ok(job) : Results.NotFound(new { error = "job not found" }));
app.MapPost("/api/jobs", async (JobRequest req, IHttpClientFactory httpFactory) =>
{
    if (string.IsNullOrWhiteSpace(req.Type)) return Results.BadRequest(new { error = "Type is required" });
    var allowed = new[] { "vision", "geometry-repair", "split-joints" };
    if (!allowed.Contains(req.Type)) return Results.BadRequest(new { error = $"unknown job type {req.Type}" });
    string id = Guid.NewGuid().ToString("N")[..8];
    var job = new PipelineJob(id, req.Type, "queued", 0, req.Input, CreatedAt: DateTimeOffset.UtcNow);
    jobs[id] = job;
    logger.LogInformation("Job {Id} queued type={Type}", id, req.Type);
    _ = Task.Run(async () =>
    {
        try
        {
            Update(id, job with { Status = "running", Progress = 10 });
            if (req.Type == "vision")
                await RunVisionAsync(id, req.Input, visionUrl, httpFactory, logger);
            else if (req.Type is "geometry-repair" or "split-joints")
                await RunGeometryAsync(id, req.Input, geometryCli, logger);
            else
                Update(id, jobs[id] with { Status = "failed", Error = $"unknown job type {req.Type}" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Job {Id} failed", id);
            if (jobs.TryGetValue(id, out var j)) Update(id, j with { Status = "failed", Error = ex.Message });
        }
    });
    return Results.Accepted($"/api/jobs/{id}", job);
    void Update(string jobId, PipelineJob updated) => jobs[jobId] = updated with { UpdatedAt = DateTimeOffset.UtcNow };
});

app.Run();

async Task RunVisionAsync(string jobId, IReadOnlyDictionary<string, string?>? input, string serviceUrl, IHttpClientFactory factory, ILogger log)
{
    var imagePath = input?.GetValueOrDefault("imagePath") ?? input?.GetValueOrDefault("srcPath") ?? "";
    try
    {
        var client = factory.CreateClient("vision");
        var response = await client.PostAsJsonAsync($"{serviceUrl.TrimEnd('/')}/api/generate",
            new { srcPath = imagePath, generator = "procedural", outputFormat = "obj" });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<VisionResult>();
        var output = new Dictionary<string, string?> { ["meshPath"] = body?.MeshPath, ["meshFormat"] = body?.MeshFormat };
        if (jobs.TryGetValue(jobId, out var j)) jobs[jobId] = j with { Status = "done", Progress = 100, Output = output, UpdatedAt = DateTimeOffset.UtcNow };
        log.LogInformation("Vision job {Id} done -> {Path}", jobId, body?.MeshPath);
    }
    catch (Exception ex)
    {
        log.LogError(ex, "Vision job {Id} failed", jobId);
        if (jobs.TryGetValue(jobId, out var j)) jobs[jobId] = j with { Status = "failed", Progress = 100, Error = ex.Message, UpdatedAt = DateTimeOffset.UtcNow };
    }
}

async Task RunGeometryAsync(string jobId, IReadOnlyDictionary<string, string?>? input, string cli, ILogger log)
{
    var meshPath = input?.GetValueOrDefault("meshPath") ?? "";
    if (!File.Exists(meshPath))
    {
        if (jobs.TryGetValue(jobId, out var j1)) jobs[jobId] = j1 with { Status = "failed", Error = $"geometry input missing: {meshPath}", UpdatedAt = DateTimeOffset.UtcNow };
        return;
    }
    var outPath = Path.Combine(Path.GetTempPath(), $"af_{jobId}_out.stl");
    var psi = new ProcessStartInfo(cli) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
    psi.ArgumentList.Add("repair");
    psi.ArgumentList.Add(meshPath);
    psi.ArgumentList.Add(outPath);
    try
    {
        using var proc = Process.Start(psi);
        if (proc == null)
        {
            if (jobs.TryGetValue(jobId, out var j)) jobs[jobId] = j with { Status = "failed", Error = "geometry CLI could not start", UpdatedAt = DateTimeOffset.UtcNow };
            return;
        }
        var stdoutTask = proc.StandardOutput.ReadToEndAsync();
        var stderrTask = proc.StandardError.ReadToEndAsync();
        var exited = await proc.WaitForExitAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(60));
        var stdout = await stdoutTask;
        var stderr = await stderrTask;
        if (!proc.HasExited) { try { proc.Kill(true); } catch { } }
        var status = proc.ExitCode == 0 && File.Exists(outPath) ? "done" : "failed";
        var output = new Dictionary<string, string?> { ["stdout"] = stdout, ["stderr"] = stderr, ["outputPath"] = outPath };
        if (jobs.TryGetValue(jobId, out var j2)) jobs[jobId] = j2 with { Status = status, Progress = 100, Output = output, UpdatedAt = DateTimeOffset.UtcNow, Error = status == "failed" ? stderr : null };
        log.LogInformation("Geometry job {Id} {Status}", jobId, status);
    }
    catch (Exception ex)
    {
        log.LogError(ex, "Geometry job {Id} exception", jobId);
        if (jobs.TryGetValue(jobId, out var j)) jobs[jobId] = j with { Status = "failed", Error = ex.Message, UpdatedAt = DateTimeOffset.UtcNow };
    }
}

record PipelineJob(string Id, string Type, string Status, int Progress,
                   IReadOnlyDictionary<string, string?>? Input = null,
                   IReadOnlyDictionary<string, string?>? Output = null, string? Error = null,
                   DateTimeOffset CreatedAt = default, DateTimeOffset UpdatedAt = default)
{
    public IReadOnlyDictionary<string, string?> Input { get; init; } = Input ?? new Dictionary<string, string?>();
    public IReadOnlyDictionary<string, string?> Output { get; init; } = Output ?? new Dictionary<string, string?>();
}
record JobRequest(string Type, IReadOnlyDictionary<string, string?>? Input);
record VisionResult(string MeshPath, string? MeshFormat, Dictionary<string, int>? Stats);
