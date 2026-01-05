/**
 * Web Tools
 * 
 * Nástroje pro přístup k internetu.
 */

import { registerTool } from "./registry.js";

// ================== HTTP TOOLS ==================

registerTool({
  name: "web:fetch",
  category: "web",
  description: "Fetch content from URL",
  risk: "low",
  parameters: {
    url: { type: "string", required: true },
    method: { type: "string", default: "GET" },
    headers: { type: "object", default: {} },
    body: { type: "string", default: null },
    timeout: { type: "number", default: 30000 }
  },
  async execute({ url, method = "GET", headers = {}, body, timeout = 30000 }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "User-Agent": "C3-Agent/1.0",
          ...headers
        },
        body: body || undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get("content-type") || "";
      let content;

      if (contentType.includes("application/json")) {
        content = await response.json();
      } else {
        content = await response.text();
      }

      return {
        success: true,
        url,
        status: response.status,
        statusText: response.statusText,
        contentType,
        content,
        headers: Object.fromEntries(response.headers.entries())
      };

    } catch (error) {
      clearTimeout(timeoutId);
      
      return {
        success: false,
        url,
        error: error.name === "AbortError" ? "Request timed out" : error.message
      };
    }
  }
});

registerTool({
  name: "web:search",
  category: "web",
  description: "Search the web using DuckDuckGo",
  risk: "low",
  parameters: {
    query: { type: "string", required: true },
    maxResults: { type: "number", default: 10 }
  },
  async execute({ query, maxResults = 10 }) {
    // Using DuckDuckGo HTML version (no API key needed)
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; C3-Agent/1.0)"
        }
      });

      const html = await response.text();
      
      // Parse results from HTML
      const results = [];
      const resultRegex = /<a class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      
      // Helper to decode DDG redirect URLs
      function decodeUrl(ddgUrl) {
        // DDG uses //duckduckgo.com/l/?uddg=ENCODED_URL
        if (ddgUrl.includes('uddg=')) {
          try {
            const match = ddgUrl.match(/uddg=([^&]+)/);
            if (match) {
              return decodeURIComponent(match[1]);
            }
          } catch (e) {}
        }
        // Some URLs are direct
        if (ddgUrl.startsWith('//')) {
          return 'https:' + ddgUrl;
        }
        return ddgUrl;
      }
      
      let match;
      while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
        results.push({
          url: decodeUrl(match[1]),
          title: match[2].trim(),
          snippet: match[3].replace(/<[^>]+>/g, "").trim()
        });
      }

      // Fallback: simpler regex if above doesn't match
      if (results.length === 0) {
        const simpleRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\/a>/g;
        while ((match = simpleRegex.exec(html)) !== null && results.length < maxResults) {
          results.push({
            url: decodeUrl(match[1]),
            title: match[2].trim(),
            snippet: ""
          });
        }
      }

      return {
        success: true,
        query,
        results,
        count: results.length
      };

    } catch (error) {
      return {
        success: false,
        query,
        error: error.message
      };
    }
  }
});

registerTool({
  name: "web:extract",
  category: "web",
  description: "Extract readable content from a webpage",
  risk: "low",
  parameters: {
    url: { type: "string", required: true }
  },
  async execute({ url }) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; C3-Agent/1.0)"
        }
      });

      const html = await response.text();

      // Simple content extraction
      // Remove scripts, styles, and HTML tags
      let content = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : "";

      // Extract meta description
      const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
      const description = descMatch ? descMatch[1].trim() : "";

      // Limit content length
      if (content.length > 10000) {
        content = content.substring(0, 10000) + "...";
      }

      return {
        success: true,
        url,
        title,
        description,
        content,
        contentLength: content.length
      };

    } catch (error) {
      return {
        success: false,
        url,
        error: error.message
      };
    }
  }
});

registerTool({
  name: "web:download",
  category: "web",
  description: "Download file from URL",
  risk: "medium",
  parameters: {
    url: { type: "string", required: true },
    destination: { type: "string", required: true }
  },
  async execute({ url, destination }, context) {
    const fs = await import("fs");
    const path = await import("path");
    
    const workdir = context.workdir || process.cwd();
    const destPath = path.resolve(workdir, destination);

    // Ensure destination is within workdir
    if (!destPath.startsWith(path.resolve(workdir))) {
      throw new Error("Destination must be within working directory");
    }

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      
      // Ensure directory exists
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, buffer);

      return {
        success: true,
        url,
        destination,
        size: buffer.length
      };

    } catch (error) {
      return {
        success: false,
        url,
        error: error.message
      };
    }
  }
});

// ================== API TOOLS ==================

registerTool({
  name: "api:rest",
  category: "web",
  description: "Make REST API call",
  risk: "low",
  parameters: {
    url: { type: "string", required: true },
    method: { type: "string", default: "GET" },
    headers: { type: "object", default: {} },
    body: { type: "object", default: null },
    auth: { type: "object", default: null }
  },
  async execute({ url, method = "GET", headers = {}, body, auth }) {
    const requestHeaders = {
      "Content-Type": "application/json",
      "User-Agent": "C3-Agent/1.0",
      ...headers
    };

    // Handle authentication
    if (auth) {
      if (auth.type === "bearer") {
        requestHeaders["Authorization"] = `Bearer ${auth.token}`;
      } else if (auth.type === "basic") {
        const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
        requestHeaders["Authorization"] = `Basic ${credentials}`;
      }
    }

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined
      });

      const contentType = response.headers.get("content-type") || "";
      let data;

      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      return {
        success: response.ok,
        url,
        method,
        status: response.status,
        data
      };

    } catch (error) {
      return {
        success: false,
        url,
        error: error.message
      };
    }
  }
});

console.log("🌐 Web tools registered");
