import TournamentModel from "../models/tournament_model";
import userModel from "../models/user_model";
import axios from "axios";

// עדכון ממשק LichessChallengeResponse בקובץ tournament_logic.ts
interface LichessChallengeResponse {
  id: string;
  challenge?: { id: string };  // הוספת תכונה challenge כאופציונלית
  url?: string;
  urlWhite?: string;
  urlBlack?: string;
}

export const advanceTournamentRound = async (tournamentId: string) => {
  try {
    console.log(`🔍 Checking if tournament ${tournamentId} can advance to next round`);
    
    const tournament = await TournamentModel.findById(tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    // לא ניתן להתקדם אם הטורניר סיים
    if (tournament.status === "completed") {
      console.log("🏁 Tournament already completed");
      return {
        success: false,
        message: "Tournament already completed",
        completed: true,
        winner: tournament.winner
      };
    }

    // בדיקת הסיבוב האחרון
    const lastBracket = tournament.bracket[tournament.bracket.length - 1];
    if (!lastBracket) {
      console.log("❌ No brackets found in tournament");
      throw new Error("No brackets found");
    }

    const FINISHED_RESULTS = ["finished", "completed", "mate", "resign", "timeout", "cheat"];
    
    // בדיקת סטטוס כל המשחקים
    const pendingMatches = lastBracket.matches.filter(
      (match) => !FINISHED_RESULTS.includes(match.result as string)
    );

    if (pendingMatches.length > 0) {
      console.log(`⏳ ${pendingMatches.length} matches still waiting to finish`);
      return {
        success: false,
        message: `${pendingMatches.length} matches still need to finish`,
        pendingMatches: pendingMatches.length
      };
    }

    // איסוף המנצחים
    const winners = lastBracket.matches
      .map((m) => m.winner)
      .filter((w): w is string => Boolean(w) && w !== "draw");
    
    // הוספת שחקנים שקיבלו bye בסיבוב הקודם
    const allWinners = [...winners, ...tournament.advancingPlayers];
    
    console.log(`✅ Found ${allWinners.length} advancing players: ${allWinners.join(', ')}`);

    // אם יש רק מנצח אחד, הטורניר הסתיים
    if (allWinners.length === 1) {
      tournament.status = "completed";
      tournament.winner = allWinners[0];
      await tournament.save();
      console.log(`🏆 Tournament completed with winner: ${allWinners[0]}`);
      return {
        success: true,
        message: `Tournament completed with winner: ${allWinners[0]}`,
        completed: true,
        winner: allWinners[0]
      };
    }

    // טיפול במספר אי-זוגי של מנצחים
    let advancingPlayers = [...allWinners];
    let byePlayer = null;

    if (advancingPlayers.length % 2 !== 0) {
      // בחירה אקראית של שחקן שיקבל bye
      const randomIndex = Math.floor(Math.random() * advancingPlayers.length);
      byePlayer = advancingPlayers.splice(randomIndex, 1)[0];
      console.log(`🚨 Player ${byePlayer} gets a bye to next round`);
    }

    // שמות הסיבובים
    const roundNames = ["Round 1", "Quarterfinals", "Semifinals", "Final"];
    const nextRoundIndex = tournament.currentStage + 1;
    const nextBracketName = roundNames[nextRoundIndex] || `Round ${nextRoundIndex + 1}`;
    
    // יצירת משחקים חדשים
    const newMatches = [];
    const creator = await userModel.findById(tournament.createdBy);
    
    if (!creator || !creator.lichessAccessToken) {
      throw new Error("Creator not found or not authorized with Lichess");
    }

    // יצירת המשחקים
    for (let i = 0; i < advancingPlayers.length; i += 2) {
      const p1 = advancingPlayers[i];
      const p2 = advancingPlayers[i + 1];
      
      console.log(`🎮 Creating next round match: ${p1} vs ${p2}`);
      
      let success = false;
      let retries = 3;
      
      while (retries > 0 && !success) {
        try {
          const response = await axios.post<LichessChallengeResponse>(
            "https://lichess.org/api/challenge/open", // שימוש באתגר פתוח במקום ישיר
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
          
          // טיפול במקרה שחסרים שדות - לא מסתמכים על תכונה אחת ספציפית
          const gameId = challenge.id || challenge.challenge?.id;
          if (!gameId) {
            throw new Error("Missing game ID in Lichess response");
          }
          
          const gameUrl = `https://lichess.org/${gameId}`;
          const whiteUrl = challenge.urlWhite || `${gameUrl}?color=white`;
          const blackUrl = challenge.urlBlack || `${gameUrl}?color=black`;
          
          newMatches.push({
            player1: p1,
            player2: p2,
            lichessUrl: gameUrl,
            whiteUrl: whiteUrl,
            blackUrl: blackUrl,
            result: "pending",
            winner: null
          });
          
          success = true;
          console.log(`✅ Created match: ${p1} vs ${p2} (${gameUrl})`);
          
          // המתנה בין בקשות
          await new Promise(resolve => setTimeout(resolve, 1500));
          
        } catch (err) {
          retries--;
          console.error(`❌ Attempt ${3-retries}/3 failed for ${p1} vs ${p2}:`, err);
          
          if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            // יצירת "משחק פגום" שניתן לתקן ידנית
            newMatches.push({
              player1: p1,
              player2: p2,
              lichessUrl: `https://lichess.org/error-placeholder-${Date.now()}`,
              whiteUrl: "#",
              blackUrl: "#",
              result: "error",
              winner: null
            });
          }
        }
      }
    }

    // עדכון הטורניר
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
    
  } catch (error) {
    console.error("❌ Error advancing tournament round:", error);
    throw error;
  }
};

export default advanceTournamentRound;