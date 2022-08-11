require("dotenv").config({path: ".env"});
const kjs = require("./");

console.log(process.env["BPOW_KEY"]);

(async () => {
    const hash = "F487351DE117C929AA3644CA05BCC9280294BE4D8F9FFCEB5B4A26B6676DC06C";
    const difficultyMultiplier = 128;
    const pow = await kjs.generateWork(hash, process.env["BPOW_KEY"], difficultyMultiplier);
    console.log(pow);
    // 00000000ae908e3f
})()
