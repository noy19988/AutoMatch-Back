import TournamentModel from "../models/tournament_model";
import userModel from "../models/user_model";
import axios from "axios";


// ממשק תגובת Lichess
interface LichessChallengeResponse {
  id: string;
  challenge?: { id: string };
  url?: string;
  urlWhite?: string;
  urlBlack?: string;
}

// פונקציה לקביעת שם הסיבוב לפי מספר שחקנים
const getBracketName = (playerCount: number): string => {
  switch (playerCount) {
    case 2:
      return "Final";
    case 4:
      return "Semifinals";
    case 8:
      return "Quarterfinals";
    case 16:
      return "Round of 16";
    case 32:
      return "Round of 32";
    default:
      return `Round of ${playerCount}`;
  }
};

export const advanceTournamentRound = async (tournamentId: string) => {
  try {
    console.log(`🔍 Checking if tournament ${tournamentId} can advance to next round`);

    const tournament = await TournamentModel.findById(tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    if (tournament.status === "completed") {
      console.log("🏁 Tournament is already completed. Skipping advancement.");
      return {
        success: false,
        message: "Tournament already completed",
        completed: true,
        winner: tournament.winner
      };
    }

    const lastBracket = tournament.bracket[tournament.bracket.length - 1];
    if (!lastBracket) throw new Error("No brackets found");

    const FINISHED_RESULTS = ["finished", "completed", "mate", "resign", "timeout", "cheat"];

    const pendingMatches = lastBracket.matches.filter(
      (match) => !FINISHED_RESULTS.includes(match.result as string)
    );

    if (pendingMatches.length > 0) {
      return {
        success: false,
        message: `${pendingMatches.length} matches still need to finish`,
        pendingMatches: pendingMatches.length
      };
    }

    // זיהוי משחקים שסומנו כ"finished" אבל אין להם מנצח
    const noWinnerMatches = lastBracket.matches.filter(
      (m) => FINISHED_RESULTS.includes(m.result as string) && !m.winner
    );
    if (noWinnerMatches.length > 0) {
      console.warn(`⚠️ ${noWinnerMatches.length} finished matches have no winner:`, noWinnerMatches.map(m => `${m.player1} vs ${m.player2}`));
    }

    const winners = lastBracket.matches
      .map((m) => m.winner)
      .filter((w): w is string => Boolean(w) && w !== "draw");

    const allWinners = [...winners, ...tournament.advancingPlayers];
    const uniqueWinners = [...new Set(allWinners)];
    console.log(`✅ Found ${uniqueWinners.length} advancing players: ${uniqueWinners.join(', ')}`);

    // ❗ הגנה אם אין שחקנים מתקדמים
    if (uniqueWinners.length === 0) {
      console.warn(`⚠️ No advancing players found for tournament ${tournamentId}, skipping advancement.`);
      return {
        success: false,
        message: "No advancing players found",
        completed: false,
        winner: null
      };
    }

    // סיום הטורניר אם נשאר שחקן אחד
    if (
      uniqueWinners.length <= 1 ||
      (tournament.maxPlayers === 2 && tournament.bracket.length === 1 && uniqueWinners.length === 1)
    ) {
      tournament.status = "completed";
      tournament.winner = uniqueWinners[0] || null;
      await tournament.save();

      if (tournament.winner && tournament.tournamentPrize > 0) {
        const winnerUser = await userModel.findOne({ lichessId: tournament.winner });
        if (winnerUser) {
          winnerUser.balance = (winnerUser.balance ?? 0) + tournament.tournamentPrize;
          await winnerUser.save();
          console.log(`💸 Prize of ${tournament.tournamentPrize} added to ${winnerUser.lichessId}'s balance`);
        } else {
          console.warn(`⚠️ Winner ${tournament.winner} not found in userModel`);
        }
      }

      console.log(`🏆 Tournament completed with winner: ${tournament.winner}`);
      return {
        success: true,
        message: `Tournament completed with winner: ${tournament.winner}`,
        completed: true,
        winner: tournament.winner
      };
    }

    let advancingPlayers = [...uniqueWinners];
    let byePlayer = null;

    if (advancingPlayers.length % 2 !== 0) {
      const randomIndex = Math.floor(Math.random() * advancingPlayers.length);
      byePlayer = advancingPlayers.splice(randomIndex, 1)[0];
      console.log(`🚨 Player ${byePlayer} gets a bye to next round`);
    }

    const nextRoundIndex = tournament.currentStage + 1;
    const nextBracketName = getBracketName(advancingPlayers.length + (byePlayer ? 1 : 0));

    const newMatches = [];
    const creator = await userModel.findById(tournament.createdBy);
    if (!creator || !creator.lichessAccessToken) {
      throw new Error("Creator not authorized");
    }

    for (let i = 0; i < advancingPlayers.length; i += 2) {
      const p1 = advancingPlayers[i];
      const p2 = advancingPlayers[i + 1];

      if (!p1 || !p2 || p1 === p2) {
        console.warn(`⚠️ Skipping invalid/self match: ${p1} vs ${p2}`);
        continue;
      }

      let success = false;
      let retries = 3;

      while (retries > 0 && !success) {
        try {
          const response = await axios.post<LichessChallengeResponse>(
            "https://lichess.org/api/challenge/open",
            {
              rated: tournament.rated,
              clock: { limit: 300, increment: 0 },
              variant: "standard",
            },
            {
              headers: {
                Authorization: `Bearer ${creator.lichessAccessToken}`,
                Accept: "application/json",
              },
              timeout: 10000
            }
          );

          const challenge = response.data;
          const gameId = challenge.id || challenge.challenge?.id;
          if (!gameId) throw new Error("Missing game ID");

          const gameUrl = `https://lichess.org/${gameId}`;
          const whiteUrl = challenge.urlWhite || `${gameUrl}?color=white`;
          const blackUrl = challenge.urlBlack || `${gameUrl}?color=black`;

          newMatches.push({
            player1: p1,
            player2: p2,
            lichessUrl: gameUrl,
            whiteUrl,
            blackUrl,
            result: "pending",
            winner: null
          });

          success = true;
          console.log(`✅ Created match: ${p1} vs ${p2} (${gameUrl})`);
          await new Promise(res => setTimeout(res, 1500));

        } catch (err) {
          retries--;
          console.error(`❌ Retry ${3 - retries}/3 failed for ${p1} vs ${p2}:`, err);

          if (retries === 0) {
            newMatches.push({
              player1: p1,
              player2: p2,
              lichessUrl: `https://lichess.org/error-placeholder-${Date.now()}`,
              whiteUrl: "#",
              blackUrl: "#",
              result: "error",
              winner: null
            });
          } else {
            await new Promise(res => setTimeout(res, 2000));
          }
        }
      }
    }

    if (newMatches.length > 0) {
      const newBracket = {
        name: nextBracketName,
        matches: newMatches,
        startTime: new Date()
      };

      tournament.bracket.push(newBracket);
      tournament.currentStage = nextRoundIndex;
      tournament.advancingPlayers = byePlayer ? [byePlayer] : [];

      await tournament.save();

      console.log(`✅ Tournament advanced to ${nextBracketName}`);
      return {
        success: true,
        message: `Advanced to ${nextBracketName}`,
        byePlayer,
        matches: newMatches.length
      };
    } else {
      console.log("⚠️ No matches created, skipping round advancement.");
      return {
        success: false,
        message: "No matches created, tournament may already be complete",
        matches: 0
      };
    }

  } catch (error) {
    console.error("❌ Error advancing tournament round:", error);
    throw error;
  }
};


export default advanceTournamentRound;
