const http = require("http");
const https = require("https");
const PORT = process.env.PORT || 3000;
const SECRET_KEY = "Dn9zPnebJCrotOFr9UBu";

// ── Shared HTTPS GET helper ────────────────────────────
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
				try { resolve(JSON.parse(data)); }
				catch (e) { reject(new Error("Failed to parse JSON: " + data.substring(0, 200))); }
			});
		});
		req.on("error", reject);
		req.setTimeout(10000, () => { req.destroy(); reject(new Error("Request timed out")); });
	});
}

// ── Shared key validation ──────────────────────────────
function validateKey(req, res) {
	const clientKey = req.headers["x-proxy-key"];
	if (clientKey !== SECRET_KEY) {
		res.writeHead(403);
		res.end(JSON.stringify({ error: "Forbidden — invalid proxy key" }));
		console.warn("[Proxy] Rejected request — wrong key");
		return false;
	}
	return true;
}

// ── Raw pagination fetcher (preserves assetType per item) ──
async function fetchCatalogItemsRaw(params, label) {
	const results = [];
	let cursor = "";
	let page = 0;
	const MAX_PAGES = 10;

	while (page < MAX_PAGES) {
		const queryString = Object.entries(params)
			.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
			.join("&");
		const url = `https://catalog.roblox.com/v1/search/items/details?${queryString}`
			+ (cursor ? `&cursor=${cursor}` : "");

		let result;
		try {
			result = await httpsGet(url);
		} catch (e) {
			console.error(`[Proxy] Failed fetching ${label} page ${page}:`, e.message);
			break;
		}

		if (!result.data || result.data.length === 0) break;

		for (const item of result.data) {
			results.push({
				id:        item.id,
				name:      item.name  || "Unknown",
				price:     item.price || 0,
				assetType: item.assetType,
			});
		}

		console.log(`[Proxy] ${label} page ${page}: ${results.length} items so far`);
		if (!result.nextPageCursor) break;
		cursor = result.nextPageCursor;
		page++;
		await new Promise(r => setTimeout(r, 300));
	}

	console.log(`[Proxy] ${label} total: ${results.length} items`);
	return results;
}

// ── Endpoint handlers ──────────────────────────────────

// GET /groupclothing?groupId=X — shirts (AssetType 11) & pants (AssetType 12)
async function handleGroupClothingSimple(req, res) {
	const urlObj  = new URL(req.url, `http://localhost:${PORT}`);
	const groupId = urlObj.searchParams.get("groupId");

	if (!groupId || isNaN(Number(groupId))) {
		res.writeHead(400);
		res.end(JSON.stringify({ error: "Missing or invalid groupId parameter" }));
		return;
	}

	console.log(`[Proxy] /groupclothing request for group ${groupId}`);

	const all = await fetchCatalogItemsRaw({
		Category:          3,
		CreatorType:       2,
		CreatorTargetId:   groupId,
		IncludeNotForSale: false,
		limit:             30,
		sortOrder:         "Desc",
	}, `group ${groupId} clothing`);

	const shirts = all.filter(i => i.assetType === 11).map(i => ({ id: i.id, name: i.name }));
	const pants  = all.filter(i => i.assetType === 12).map(i => ({ id: i.id, name: i.name }));

	if (shirts.length === 0 && pants.length === 0) {
		res.writeHead(200);
		res.end(JSON.stringify({ success: false, error: "No clothing found for this group." }));
		return;
	}

	res.writeHead(200);
	res.end(JSON.stringify({ success: true, groupId: Number(groupId), shirts, pants }));
}

// GET /grouptshirts?groupId=X — only T-shirts (AssetType 2) for a group
async function handleGroupTshirts(req, res) {
	const urlObj  = new URL(req.url, `http://localhost:${PORT}`);
	const groupId = urlObj.searchParams.get("groupId");

	if (!groupId || isNaN(Number(groupId))) {
		res.writeHead(400);
		res.end(JSON.stringify({ error: "Missing or invalid groupId parameter" }));
		return;
	}

	console.log(`[Proxy] /grouptshirts request for group ${groupId}`);

	const items = await fetchCatalogItemsRaw({
		Category:        3,
		Subcategory:     3,   // Subcategory 3 = T-Shirts
		CreatorType:     2,
		CreatorTargetId: groupId,
		IncludeNotForSale: false,
		limit:           30,
		sortOrder:       "Desc",
	}, `group ${groupId} tshirts`);

	const tshirts = items.filter(i => i.assetType === 2).map(i => ({
		id:    i.id,
		name:  i.name,
		price: i.price || 0,
	}));

	if (tshirts.length === 0) {
		res.writeHead(200);
		res.end(JSON.stringify({ success: false, error: "No T-shirts found for this group." }));
		return;
	}

	res.writeHead(200);
	res.end(JSON.stringify({ success: true, groupId: Number(groupId), tshirts }));
}

// GET /usertshirts?userId=X — only T-shirts (AssetType 2) by a user
async function handleUserTshirts(req, res) {
	const urlObj = new URL(req.url, `http://localhost:${PORT}`);
	const userId = urlObj.searchParams.get("userId");

	if (!userId || isNaN(Number(userId))) {
		res.writeHead(400);
		res.end(JSON.stringify({ error: "Missing or invalid userId parameter" }));
		return;
	}

	console.log(`[Proxy] /usertshirts request for user ${userId}`);

	const items = await fetchCatalogItemsRaw({
		Category:        3,
		Subcategory:     3,
		CreatorType:     1,   // CreatorType 1 = User
		CreatorTargetId: userId,
		IncludeNotForSale: false,
		limit:           30,
		sortOrder:       "Desc",
	}, `user ${userId} tshirts`);

	const tshirts = items.filter(i => i.assetType === 2).map(i => ({
		id:    i.id,
		name:  i.name,
		price: i.price || 0,
	}));

	if (tshirts.length === 0) {
		res.writeHead(200);
		res.end(JSON.stringify({ success: false, error: "No T-shirts found for this user." }));
		return;
	}

	res.writeHead(200);
	res.end(JSON.stringify({ success: true, userId: Number(userId), tshirts }));
}

// ── HTTP Server ────────────────────────────────────────
const server = http.createServer(async (req, res) => {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Content-Type", "application/json");

	const path = req.url.split("?")[0];

	// Health check — NO key required. Used by uptime monitors to keep the
	// free-tier service warm (prevents cold-start spin-down). Responds before
	// key validation so the monitor doesn't need the secret key.
	if (req.method === "GET" && (path === "/" || path === "/health")) {
		res.writeHead(200);
		res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
		return;
	}

	if (req.method !== "GET") {
		res.writeHead(404);
		res.end(JSON.stringify({ error: "Not found" }));
		return;
	}

	// Validate key for all data endpoints
	if (!validateKey(req, res)) return;

	try {
		if (path === "/groupclothing") {
			await handleGroupClothingSimple(req, res);
		} else if (path === "/grouptshirts") {
			await handleGroupTshirts(req, res);
		} else if (path === "/usertshirts") {
			await handleUserTshirts(req, res);
		} else {
			res.writeHead(404);
			res.end(JSON.stringify({ error: "Not found" }));
		}
	} catch (err) {
		console.error("[Proxy] Unhandled error:", err.message);
		res.writeHead(500);
		res.end(JSON.stringify({ error: "Internal proxy error: " + err.message }));
	}
});

server.listen(PORT, () => {
	console.log(`[Proxy] Running on port ${PORT}`);
	console.log(`[Proxy] Endpoints:`);
	console.log(`[Proxy]   GET /health                   — keyless health check`);
	console.log(`[Proxy]   GET /groupclothing?groupId=X  — shirts & pants`);
	console.log(`[Proxy]   GET /grouptshirts?groupId=X   — group T-shirts`);
	console.log(`[Proxy]   GET /usertshirts?userId=X     — user T-shirts`);
});
