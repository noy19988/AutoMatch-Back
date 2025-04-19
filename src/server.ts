import express, { Express } from "express";
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import bodyParser from "body-parser";
import session from "express-session";
import authController from "./routes/auth_route";
import swaggerJsDoc from "swagger-jsdoc";
import swaggerUI from "swagger-ui-express";
import lichessRouter from "./routes/lichess_route";

const app = express();

//Session Middleware
app.use(
  session({
    secret: "some_secret_key", 
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);

const db = mongoose.connection;
db.on("error", console.error);
db.once("open", () => console.log("Connected to Database"));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "*");
  res.header("Access-Control-Allow-Headers", "*");
  next();
});

app.use("/auth", authController);
app.use("/auth/lichess", lichessRouter);

app.get("/about", (_, res) => {
  res.send("Hello World!");
});

const options = {
  swaggerDefinition: {
    openapi: "3.0.0",
    info: {
      title: "Web Dev 2025 - D - REST API",
      version: "1.0.0",
      description: "REST server including authentication using JWT",
    },
    servers: [
      {
        url: `${process.env.BASE_URL}:${process.env.PORT}`,
      },
    ],
  },
  apis: ["./src/routes/*.ts"],
};

// @ts-ignore
const specs = swaggerJsDoc(options);
app.use("/api-docs", swaggerUI.serve, swaggerUI.setup(specs));

const initApp = () => {
  return new Promise<Express>(async (resolve, reject) => {
    if (!process.env.DB_CONNECTION) {
      reject("DB_CONNECTION is not defined");
    } else {
      await mongoose.connect(process.env.DB_CONNECTION);
      resolve(app);
    }
  });
};

export default initApp;
