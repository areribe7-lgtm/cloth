// ══════════════════════════════════════════════════════
//   Roblox Clothing Showcase Proxy
//   Fetches group clothing asset IDs from Roblox's catalog
//   and returns them to your Roblox game via HTTP.
// ══════════════════════════════════════════════════════

const http = require("http");
const https = require("https");

// ── CONFIG ────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

// Your Roblox game's HttpService will send this key in
// every request header so random people can't abuse your proxy.
// Change this to any long random string you want.
// You will paste the same string into your Roblox server script later.
const SECRET_KEY = "CHANGE_THIS_TO_A_LONG_RANDOM_STRING_12345";
// ── END CONFIG ────────────────────────────────────────

// Simple HTTPS GET helper — returns parsed JSON or throws
function httpsGet(url) {
	return new Promise((resolve, reject) => {
		const req = https.get(url, {
			headers: {
				"User-Agent": "RobloxClothingProxy/1.0",
				"Accept": "application/json",
			}
		}, (res) => {
			let data = "";
			res.on("data", chunk => data += chunk);
			res.on("end", () => {
				try {
					resolve(JSON.parse(data));
				} catch (e) {
					reject(new Error("Failed to parse JSON: " + data.substring(0, 200)));
				}
			});
		});
		req.on("error", reject);
		req.setTimeout(10000, () => {
			req.destroy();
			reject(new Error("Request timed out"));
		});
	});
}

// Fetch ALL clothing pages for a group (handles pagination)
async function fetchGroupClothing(groupId) {
	const shirts = [];
	const pants   = [];

	// Roblox catalog subcategory IDs: 61 = Shirts, 62 = Pants
	const categories = [
		{ subtype: 61, label: "Shirts",  list: shirts },
		{ subtype: 62, label: "Pants",   list: pants  },
	];

	for (const cat of categories) {
		let cursor = "";
		let page   = 0;
		const MAX_PAGES = 10; // safety cap — 10 pages * 30 items = 300 items max per type

		while (page < MAX_PAGES) {
			const url = `https://catalog.roblox.com/v1/search/items`
				+ `?Category=3`                          // Category 3 = Clothing
				+ `&Subcategory=${cat.subtype}`
				+ `&CreatorType=2`                       // CreatorType 2 = Group
				+ `&CreatorTargetId=${groupId}`
				+ `&limit=30`
				+ `&sortOrder=Desc`
				+ (cursor ? `&cursor=${cursor}` : "");

			let result;
			try {
				result = await httpsGet(url);
			} catch (e) {
				console.error(`[Proxy] Failed fetching ${cat.label} page ${page}:`, e.message);
				break;
			}

			if (!result.data || result.data.length === 0) break;

			for (const item of result.data) {
				cat.list.push({
					id:   item.id,
					name: item.name || "Unknown",
				});
			}

			if (!result.nextPageCursor) break;
			cursor = result.nextPageCursor;
			page++;

			// Small delay between pages to be polite to Roblox's API
			await new Promise(r => setTimeout(r, 300));
		}

		console.log(`[Proxy] Fetched ${cat.list.length} ${cat.label} for group ${groupId}`);
	}

	return { shirts, pants };
}

// ── HTTP Server ───────────────────────────────────────
const server = http.createServer(async (req, res) => {

	// CORS headers — allow requests from anywhere
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Content-Type", "application/json");

	// Only allow GET to /groupclothing
	if (req.method !== "GET" || !req.url.startsWith("/groupclothing")) {
		res.writeHead(404);
		res.end(JSON.stringify({ error: "Not found" }));
		return;
	}

	// Validate secret key header
	const clientKey = req.headers["x-proxy-key"];
	if (clientKey !== SECRET_KEY) {
		res.writeHead(403);
		res.end(JSON.stringify({ error: "Forbidden — invalid proxy key" }));
		console.warn("[Proxy] Rejected request — wrong key");
		return;
	}

	// Parse groupId from query string
	const urlObj  = new URL(req.url, `http://localhost:${PORT}`);
	const groupId = urlObj.searchParams.get("groupId");

	if (!groupId || isNaN(Number(groupId))) {
		res.writeHead(400);
		res.end(JSON.stringify({ error: "Missing or invalid groupId parameter" }));
		return;
	}

	console.log(`[Proxy] Request for group ${groupId}`);

	try {
		const clothing = await fetchGroupClothing(groupId);

		if (clothing.shirts.length === 0 && clothing.pants.length === 0) {
			res.writeHead(200);
			res.end(JSON.stringify({
				success: false,
				error:   "No clothing found for this group. Make sure the group is public and has clothing items.",
			}));
			return;
		}

		res.writeHead(200);
		res.end(JSON.stringify({
			success: true,
			groupId: Number(groupId),
			shirts:  clothing.shirts,
			pants:   clothing.pants,
		}));

	} catch (err) {
		console.error("[Proxy] Error:", err.message);
		res.writeHead(500);
		res.end(JSON.stringify({ error: "Internal proxy error: " + err.message }));
	}
});

server.listen(PORT, () => {
	console.log(`[Proxy] Running on port ${PORT}`);
	console.log(`[Proxy] Endpoint: GET /groupclothing?groupId=YOUR_GROUP_ID`);
});
