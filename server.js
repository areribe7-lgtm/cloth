const http = require("http");
const https = require("https");
const PORT = process.env.PORT || 3000;
const SECRET_KEY = "Dn9zPnebJCrotOFr9UBu";

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

async function fetchGroupClothing(groupId) {
	const shirts = [];
	const pants = [];

	let cursor = "";
	let page = 0;
	const MAX_PAGES = 10;

	while (page < MAX_PAGES) {
		const url = `https://catalog.roblox.com/v1/search/items/details`
			+ `?Category=3`
			+ `&CreatorType=2`
			+ `&CreatorTargetId=${groupId}`
			+ `&IncludeNotForSale=false`
			+ `&limit=30`
			+ `&sortOrder=Desc`
			+ (cursor ? `&cursor=${cursor}` : "");

		let result;
		try {
			result = await httpsGet(url);
		} catch (e) {
			console.error(`[Proxy] Failed fetching page ${page}:`, e.message);
			break;
		}

		if (!result.data || result.data.length === 0) break;

		for (const item of result.data) {
			// AssetType 11 = Shirt, AssetType 12 = Pants
			if (item.assetType === 11) {
				shirts.push({ id: item.id, name: item.name || "Unknown" });
			} else if (item.assetType === 12) {
				pants.push({ id: item.id, name: item.name || "Unknown" });
			}
		}

		console.log(`[Proxy] Page ${page}: found ${shirts.length} shirts, ${pants.length} pants so far`);

		if (!result.nextPageCursor) break;
		cursor = result.nextPageCursor;
		page++;

		await new Promise(r => setTimeout(r, 300));
	}

	console.log(`[Proxy] Total: ${shirts.length} shirts, ${pants.length} pants for group ${groupId}`);
	return { shirts, pants };
}

const server = http.createServer(async (req, res) => {

	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Content-Type", "application/json");

	if (req.method !== "GET" || !req.url.startsWith("/groupclothing")) {
		res.writeHead(404);
		res.end(JSON.stringify({ error: "Not found" }));
		return;
	}

	const clientKey = req.headers["x-proxy-key"];
	if (clientKey !== SECRET_KEY) {
		res.writeHead(403);
		res.end(JSON.stringify({ error: "Forbidden — invalid proxy key" }));
		console.warn("[Proxy] Rejected request — wrong key");
		return;
	}

	const urlObj = new URL(req.url, `http://localhost:${PORT}`);
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
				error: "No clothing found for this group. Make sure the group is public and has clothing items.",
			}));
			return;
		}

		res.writeHead(200);
		res.end(JSON.stringify({
			success: true,
			groupId: Number(groupId),
			shirts: clothing.shirts,
			pants: clothing.pants,
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
