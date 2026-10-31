// Minimal scripted stand-in for Ollama's /api/chat, for demos/tests without a GPU.
// Usage: node scripts/mock-ollama.mjs   (listens on :11434). It is NOT a language model:
// it picks tools by keyword so the full tool-calling path (server -> tools -> DB) can be exercised.
import http from "node:http";

const reply = (res, message) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ model: "mock", message, done: true }));
};
const call = (name, args = {}) => ({ role: "assistant", content: "", tool_calls: [{ function: { name, arguments: args } }] });

http
  .createServer((req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ models: [{ name: "mock" }] }));
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { messages = [] } = JSON.parse(body || "{}");
      const last = messages[messages.length - 1] ?? {};
      const admin = messages[0]?.content?.includes("ADMINISTRATOR");
      if (last.role === "tool") {
        if (admin && last.tool_name === "find_improvements") {
          const data = JSON.parse(last.content);
          const ids = (data.candidati ?? []).slice(0, 2).map((c) => c.id);
          if (!ids.length) return reply(res, { role: "assistant", content: "[mock] Optimizatorul nu a găsit îmbunătățiri." });
          return reply(res, call("propose_changes", { candidate_ids: ids, rationale: `[mock] Combin ${ids.join(" și ")}: cele mai bune variante găsite de optimizator.` }));
        }
        return reply(res, { role: "assistant", content: `[mock] Am primit datele de la ${last.tool_name}:\n${last.content.slice(0, 400)}` });
      }
      const t = (last.content ?? "").toLowerCase();
      if (admin) {
        const m = (last.content ?? "").match(/nu[- ]?l muta pe (\p{L}+)/iu);
        return reply(res, call("find_improvements", m ? { exclude_employee_names: [m[1]] } : {}));
      }
      if (t.includes("senior") || t.includes("lipsește")) return reply(res, call("get_my_career_gap", {}));
      if (t.includes("avsec") || t.includes("cer ")) return reply(res, call("create_request", { type: "CAREER_INFO", details: "Informații despre următorul curs AVSEC", summary: "Cerere informații curs AVSEC" }));
      if (t.includes("cine")) return reply(res, call("get_my_shifts", {}));
      if (t.includes("lucrez") || t.includes("tur")) return reply(res, call("get_my_shifts", {}));
      return reply(res, { role: "assistant", content: "[mock] Bună! Întreabă-mă despre ture, avansare sau o cerere." });
    });
  })
  .listen(11434, () => console.log("mock ollama on :11434"));
