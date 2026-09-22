import http from "node:http";
import fs from "node:fs";

const file = process.argv[2];
const port = Number(process.argv[3] || 8080);
const buf = fs.readFileSync(file);

http
  .createServer((req, res) => {
    if (req.url === "/" || req.url === "/challenger-dist.zip") {
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=challenger-dist.zip",
        "Content-Length": buf.length,
      });
      res.end(buf);
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  })
  .listen(port, "0.0.0.0", () => console.log(`serving ${file} on 0.0.0.0:${port}`));
