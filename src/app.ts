import appInit from "./server";
import dotenv from "dotenv";

dotenv.config();

const port = process.env.PORT || 3000;

const tmpFunc = async () => {
  const app = await appInit();
  app.listen(port, () => {
    console.log(`Server running at ${process.env.BASE_URL}:${port}`);
  });
};

tmpFunc();
