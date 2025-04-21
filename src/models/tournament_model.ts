import mongoose, { Document, Schema } from "mongoose";

interface Match {
  player1: string;
  player2: string;
  lichessUrl: string;
  result?: "pending" | "player1" | "player2";
  whiteUrl: string;
  blackUrl: string;
}

interface Round {
  matches: Match[];
}

export interface TournamentDocument extends Document {
  createdBy: mongoose.Types.ObjectId;
  playerIds: string[];
  rounds: Round[];
  winner: string | null;
  maxPlayers: number;
}

const matchSchema = new Schema<Match>(
  {
    player1: { type: String, required: true },
    player2: { type: String, required: true },
    lichessUrl: { type: String, required: true },
    whiteUrl: { type: String, required: true },
    blackUrl: { type: String, required: true },
  },
  { _id: false }
);

const roundSchema = new Schema<Round>(
  {
    matches: [matchSchema],
  },
  { _id: false }
);

const tournamentSchema = new Schema<TournamentDocument>({
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  playerIds: { type: [String], required: true },
  rounds: { type: [roundSchema], default: [] },
  winner: { type: String, default: null },
  maxPlayers: { type: Number, default: 8 },
});

export default mongoose.model<TournamentDocument>(
  "Tournament",
  tournamentSchema
);
