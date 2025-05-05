"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const lichess_controller_1 = __importDefault(require("../controllers/lichess_controller"));
const tournament_model_1 = __importDefault(require("../models/tournament_model"));
const router = express_1.default.Router();
router.get("/login", lichess_controller_1.default.loginWithLichess);
router.get("/callback", lichess_controller_1.default.lichessCallback);
router.get("/matchmaking", lichess_controller_1.default.autoMatchWithAI);
router.post("/tournaments/:id/join", lichess_controller_1.default.joinLobby);
router.post("/tournaments", lichess_controller_1.default.createTournament);
router.get("/tournaments/:id", (async (req, res) => {
    try {
        const tournament = await tournament_model_1.default.findById(req.params.id);
        if (!tournament) {
            return res.status(404).json({ error: "Tournament not found" });
        }
        const data = tournament.toObject();
        const enrichedPlayers = await Promise.all(data.playerIds.map(async (player) => {
            const id = typeof player === "string" ? player : player.id;
            if (!id || typeof id !== "string")
                return null;
            try {
                const userRes = await fetch(`https://lichess.org/api/user/${encodeURIComponent(id)}`);
                const userData = await userRes.json();
                return {
                    id: id, // Ensure id is a string
                    username: userData.username,
                    rating: userData.perfs?.blitz?.rating ?? 1500,
                    avatar: "/placeholder.svg",
                };
            }
            catch {
                return {
                    id: id, // Ensure id is a string
                    username: id,
                    rating: 1500,
                    avatar: "/placeholder.svg",
                };
            }
        }));
        const filteredPlayers = enrichedPlayers.filter((p) => p !== null);
        res.json({
            ...data,
            maxPlayers: data.maxPlayers,
            playerIds: filteredPlayers.map((player) => player.id), // Ensure playerIds are strings
        });
    }
    catch (err) {
        console.error("❌ Failed to fetch tournament:", err);
        res.status(500).json({ error: "Internal server error" });
    }
}));
router.post("/tournaments/:id/start", lichess_controller_1.default.startTournament);
// /routes/lichess_routes.ts
router.post("/tournaments/updateMatchResultByLichessUrl", lichess_controller_1.default.updateMatchResultByLichessUrl);
router.get("/lichess/game/:gameId", async (req, res) => {
    try {
        await lichess_controller_1.default.getGameResult(req, res); // Now calls the controller directly
    }
    catch (error) {
        console.error("Error in /lichess/game/:gameId route:", error);
        res
            .status(500)
            .json({ error: "An error occurred while fetching the game result" });
    }
});
router.get("/api/lichess/game/:gameUrl", async (req, res) => {
    const gameUrl = req.params.gameUrl;
    try {
        const response = await fetch(`https://lichess.org/api/game/${gameUrl}/state`);
        const gameState = await response.json();
        if (gameState.status === "over") {
            res.json(gameState); // Return the game result when finished
        }
        else {
            res.json({ status: "waiting" }); // Return waiting if the game is still ongoing
        }
    }
    catch (error) {
        console.error("Error fetching game result:", error);
        res.status(500).send("Error fetching game result");
    }
});
exports.default = router;
