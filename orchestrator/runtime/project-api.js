import { listProjects, setActiveProject, getLastProject } from "./project-registry.js";
import { emit } from "./event-bus.js";

export async function handleProjectApi(req, res) {
  if (req.method === "GET" && req.url === "/projects") {
    const projects = listProjects();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ projects }));
  }

  if (req.method === "GET" && req.url === "/projects/active") {
    const active = getLastProject();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ active }));
  }

  if (req.method === "POST" && req.url === "/projects/select") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      const { project } = JSON.parse(body || "{}");
      if (!project) {
        res.writeHead(400);
        return res.end("Missing project");
      }
      setActiveProject(project);
      emit({ type: "project_selected", project });
      res.writeHead(200);
      res.end("OK");
    });
    return;
  }

  return false;
}
