import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

const ALLOWED_IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".gif",
  ".tiff",
  ".tif",
  ".eps",
  ".ps",
  ".ai",
]);
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/bmp",
  "image/gif",
  "image/tiff",
  "application/postscript",
  "application/eps",
  "application/x-eps",
  "image/eps",
  "image/x-eps",
  "application/illustrator",
  "application/pdf", // some EPS mis-labelled
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".png";
    const safeExt = ALLOWED_IMAGE_EXT.has(ext) ? ext : ".png";
    cb(null, `${randomUUID()}${safeExt}`);
  },
});

export const uploadImage = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_IMAGE_EXT.has(ext)) return cb(new Error(`Unsupported image type ${ext}. Allowed: ${[...ALLOWED_IMAGE_EXT].join(", ")}`));
    // EPS/PS use application/postscript - allow it even though not image/*
    const isAllowedMime = ALLOWED_MIME.has(file.mimetype) || file.mimetype.startsWith("image/") || file.mimetype === "application/octet-stream";
    if (!isAllowedMime) {
      return cb(new Error(`Unsupported mimetype ${file.mimetype}`));
    }
    cb(null, true);
  },
});
