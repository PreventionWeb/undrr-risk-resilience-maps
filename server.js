const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3001;

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const distDir = path.join(__dirname, "dist");
const rootDir = __dirname;
const baseDir = fs.existsSync(distDir) ? distDir : rootDir;

const server = http.createServer((req, res) => {
  const filePath = path.join(
    baseDir,
    req.url === "/" ? "index.html" : req.url,
  );

  if (!filePath.startsWith(baseDir)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Serving from ${baseDir} at http://localhost:${PORT}`);
});
