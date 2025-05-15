import express, { Request, Response } from "express";
import lichessController from "../controllers/lichess_controller";
import TournamentModel from "../models/tournament_model";
import { advanceTournamentRound } from "../controllers/tournament_logic";

const router = express.Router();

declare global {
  var lichessUserCache: Map<string, { timestamp: number; data: any }>;
}

type Player = {
  id: string;
  username: string;
  rating: number;
  avatar: string;
};

// ✅ הצטרפות ללובי
router.post(
  "/tournaments/:id/join",
  lichessController.joinLobby as express.RequestHandler
);

// ✅ יצירת טורניר
router.post(
  "/tournaments",
  lichessController.createTournament as express.RequestHandler
);

router.get(
  "/tournaments/:id",
  (async (req, res) => {
    try {
      const tournament = await TournamentModel.findById(req.params.id);
      if (!tournament) {
        return res.status(404).json({ error: "Tournament not found" });
      }

      const data = tournament.toObject();

      const enrichedPlayers = await Promise.all(
        data.playerIds.map(async (player: any) => {
          const id = typeof player === "string" ? player : player.id;
          if (!id || typeof id !== "string") return null;

          try {
            const userRes = await fetch(
              `https://lichess.org/api/user/${encodeURIComponent(id)}`
            );
            const userData = await userRes.json();
            return {
              id,
              username: userData.username,
              rating: userData.perfs?.blitz?.rating ?? 1500,
              avatar: "/placeholder.svg",
            };
          } catch {
            return {
              id,
              username: id,
              rating: 1500,
              avatar: "/placeholder.svg",
            };
          }
        })
      );

      const filteredPlayers = enrichedPlayers.filter((p): p is Player => p !== null);

      res.json({
        ...data,
        createdBy: tournament.createdBy?.toString(),
        playerIds: filteredPlayers.map((player) => player.id),
      });
    } catch (err) {
      console.error("❌ Failed to fetch tournament:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }) as express.RequestHandler
);


// ✅ תוצאה ממשחק
router.get(
  "/lichess/game/:gameId",
  lichessController.getGameResult as unknown as express.RequestHandler
);

// ✅ עדכון תוצאת משחק
router.post(
  "/tournaments/updateMatchResultByLichessUrl",
  lichessController.updateMatchResultByLichessUrl as unknown as express.RequestHandler
);

// ✅ קידום שלב בטורניר
router.post("/tournaments/:id/advance", async (req, res) => {
  try {
    await advanceTournamentRound(req.params.id);
    res.status(200).json({ message: "Tournament advanced (if possible)" });
  } catch (err) {
    console.error("❌ Error advancing tournament:", err);
    res.status(500).json({ error: "Failed to advance tournament" });
  }
});

// ✅ התחלת טורניר
router.post(
  "/tournaments/:id/start",
  lichessController.startTournament as unknown as express.RequestHandler
);

// ✅ מידע על מצב משחק מסוים
router.get("/api/lichess/game/:gameUrl", async (req, res) => {
  const gameUrl = req.params.gameUrl;

  try {
    const response = await fetch(`https://lichess.org/api/game/${gameUrl}/state`);
    const gameState = await response.json();

    if (gameState.status === "over") {
      res.json(gameState); // משחק הסתיים
    } else {
      res.json({ status: "waiting" }); // עדיין לא הסתיים
    }
  } catch (error) {
    console.error("Error fetching game result:", error);
    res.status(500).send("Error fetching game result");
  }
});


router.get("/analyze/:username", (req, res, next) => {
  console.log("🧠 Analyze route called for:", req.params.username);
  next();
}, lichessController.analyzePlayerStyle as unknown as express.RequestHandler);



router.get(
  "/analyze/game/:gameId/:username",
  lichessController.analyzeSingleGame as unknown as express.RequestHandler
);

router.get(
  "/tournaments/by-lichess-url/:lichessUrl",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { lichessUrl } = req.params;

      const tournament = await TournamentModel.findOne({
        "bracket.matches.lichessUrl": `https://lichess.org/${lichessUrl}`,
      }).select("tournamentName");

      if (!tournament) {
        res.status(404).json({ error: "Tournament not found" });
        return; // ✅ prevent continuing to res.json(...)
      }

      res.json({ tournamentName: tournament.tournamentName });
    } catch (err) {
      console.error("❌ Error fetching tournament by lichessUrl:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get(
  "/analyze/cheating/:gameId/:username",
  lichessController.detectCheating as unknown as express.RequestHandler
);


export default router;
