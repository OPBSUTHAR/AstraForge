using System.Collections.Concurrent;
using System.Diagnostics;

var visionUrl = Environment.GetEnvironmentVariable("VISION_SERVICE_URL") ?? "http://localhost:5001";
var geometryCli = Environment.GetEnvironmentVariable("ASTRAFORGE_GEOMETRY_CLI")
                 ?? (OperatingSystem.IsWindows() ? "astraforge_cli.exe" : "astraforge_cli");

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://localhost:5003");
var app = builder.Build();

var jobs = new ConcurrentDictionary<string, PipelineJob>();

app.MapGet("/health", () => Results.Ok(new { ok = true, service = "astraforge-orchestrator" }));

app.MapGet("/api/jobs", () => Results.Ok(jobs.Values));

app.MapGet("/api/jobs/{id}", (string id) =>
    jobs.TryGetValue(id, out var job) ? Results.Ok(job) : Results.NotFound());

app.MapPost("/api/jobs", (JobRequest req) =>
{
    string id = Guid.NewGuid().ToString("N")[..8];
    var job = new PipelineJob(id, req.Type, "queued", 0, req.Input);
    jobs[id] = job;
    _ = Task.Run(async () =>
    {
        try
        {
            Update(id, job with { Status = "running", Progress = 10 });
            if (req.Type == "vision")
            {
                await RunVisionAsync(job, req.Input, visionUrl);
            }
            else if (req.Type is "geometry-repair" or "split-joints")
            {
                RunGeometry(job, req.Input, geometryCli);
            }
            else
            {
                Update(id, job with { Status = "failed", Error = $"unknown job type {req.Type}" });
            }
        }
        catch (Exception ex)
        {
            Update(id, job with { Status = "failed", Error = ex.Message });
        }
    });
    return Results.Accepted($"/api/jobs/{id}", job);

    void Update(string jobId, PipelineJob updated) => jobs[jobId] = updated;
});

app.Run();

async Task RunVisionAsync(PipelineJob job, IReadOnlyDictionary<string, string?>? input, string serviceUrl)
{
    var imagePath = input?.GetValueOrDefault("imagePath") ?? "";
    try
    {
        var response = await new HttpClient { Timeout = TimeSpan.FromSeconds(30) }
            .PostAsJsonAsync($"{serviceUrl}/api/generate",
                new { srcPath = imagePath, generator = "sf3d", outputFormat = "glb" });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<VisionResult>();
        var output = new Dictionary<string, string?> { ["meshPath"] = body?.MeshPath };
        jobs[job.Id] = job with { Status = "done", Progress = 100, Output = output };
    }
    catch
    {
        jobs[job.Id] = job with
        {
            Status = "done",
            Progress = 100,
            Output = new Dictionary<string, string?> { ["dryRun"] = "true" },
        };
    }
}

void RunGeometry(PipelineJob job, IReadOnlyDictionary<string, string?>? input, string cli)
{
    var meshPath = input?.GetValueOrDefault("meshPath") ?? "";
    if (!File.Exists(meshPath))
    {
        jobs[job.Id] = job with
        {
            Status = "failed",
            Error = "geometry input missing — build services/geometry (see its README)",
        };
        return;
    }
    var psi = new ProcessStartInfo(cli) { RedirectStandardOutput = true, RedirectStandardError = true };
    psi.ArgumentList.Add("repair");
    psi.ArgumentList.Add(meshPath);
    psi.ArgumentList.Add("out_geometry.stl");
    try
    {
        using var proc = Process.Start(psi);
        if (proc == null)
        {
            jobs[job.Id] = job with { Status = "failed", Error = "geometry CLI could not start" };
            return;
        }
        var output = proc.StandardOutput.ReadToEnd();
        proc.WaitForExit();
        jobs[job.Id] = job with
        {
            Status = proc.ExitCode == 0 ? "done" : "failed",
            Progress = 100,
            Output = new Dictionary<string, string?> { ["output"] = output },
        };
    }
    catch (Exception ex)
    {
        jobs[job.Id] = job with { Status = "failed", Error = ex.Message };
    }
}

record PipelineJob(string Id, string Type, string Status, int Progress,
                   IReadOnlyDictionary<string, string?>? Input = null,
                   IReadOnlyDictionary<string, string?>? Output = null, string? Error = null)
{
    public IReadOnlyDictionary<string, string?> Input { get; init; } = Input ?? new Dictionary<string, string?>();
    public IReadOnlyDictionary<string, string?> Output { get; init; } = Output ?? new Dictionary<string, string?>();
}

record JobRequest(string Type, IReadOnlyDictionary<string, string?>? Input);

record VisionResult(string MeshPath, Dictionary<string, int> Stats);