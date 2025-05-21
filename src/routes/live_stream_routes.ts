// live_stream_routes.ts
import express, { Request, Response, RequestHandler } from "express";
import liveStreamController from "../controllers/live_stream_controller";
import { authenticateToken, AuthenticatedRequest } from "../docs/Authenticate_middleware";
import TournamentModel from "../models/tournament_model";

const router = express.Router();

// Get tournament stream data
router.get(
  "/tournaments/:id/stream",
  (liveStreamController.getTournamentStream as RequestHandler)
);

// Test endpoint to verify the route is working
router.get(
  "/ping",
  ((req: Request, res: Response) => {
    console.log(`🏓 Ping received at ${new Date().toISOString()}`);
    res.status(200).json({ 
      message: "Live stream routes are working", 
      timestamp: new Date().toISOString() 
    });
  }) as RequestHandler
);

// Chat moderation endpoints (optional)
router.delete(
  "/tournaments/:id/chat/:messageId",
  authenticateToken as RequestHandler,
  (async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id, messageId } = req.params;
      console.log(`🗑️ Request to delete message ${messageId} from tournament ${id}`);
      
      // This would be more robust with a database-backed chat system
      // For now, we just signal to delete the message via socket
      
      // Only allow tournament creator or mods to delete messages
      const tournament = await TournamentModel.findById(id);
      if (!tournament) {
        console.error(`❌ Tournament ${id} not found when trying to delete message`);
        res.status(404).json({ error: "Tournament not found" });
        return;
      }
      
      if (tournament.createdBy.toString() !== req.userId) {
        console.error(`🔒 User ${req.userId} not authorized to moderate chat for tournament ${id}`);
        res.status(403).json({ error: "Not authorized to moderate chat" });
        return;
      }
      
      // Signal message deletion via socket.io
      const io = req.app.get("socketio");
      if (!io) {
        console.error(`❌ Socket.IO instance not found on app object`);
        res.status(500).json({ error: "Socket server not initialized" });
        return;
      }
      
      io.to(id).emit("message_deleted", { messageId });
      console.log(`📢 Message deletion signal sent to tournament room ${id}`);
      
      res.status(200).json({ success: true });
    } catch (error) {
      console.error("❌ Error deleting chat message:", error);
      res.status(500).json({ 
        error: "Failed to delete message", 
        details: error instanceof Error ? error.message : String(error) 
      });
    }
  }) as RequestHandler
);

// Export the router
console.log("🔌 Live stream routes loaded");
export default router;