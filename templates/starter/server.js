import express from "express";

const app = express();
const port = process.env.PORT || 3000;

app.get("/", (_req, res) => {
  res.send("Hello from idea-to-mvp");
});

app.listen(port, () => {
  console.log(`app listening on port ${port}`);
});
