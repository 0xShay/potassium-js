require("dotenv").config({path: ".env"});
const kjs = require("./");
kjs.config({
    "node-rpc-url": "http://node.bananoplanet.cc:9950/proxy",
    "rep-account": "ban_3p1anetee7arfx9zbmspwf9c8c5r88wy6zkgwcbt7rndtcqsoj6fzuy11na3",
    "enabled-pow-methods": ["ws"]
});

kjs.sendTx(
    "597B54E0C926A347FDBC2D510E466DDB0FA15E74C9D30950227BD2F6658FFCFD",
    "ban_1shay5hdkere33pb5gawzcicp1197xp64y7gutbudj39jzo7extguucu5uz1",
    "100000000000000000000000000000",
    undefined,
    undefined,
    undefined,
    process.env.BPOW_TOKEN
).then(console.log);
// Rob the private key if you want, it's a testing key with 20 BAN in there :)

// kjs.isBpowOnline().then(console.log);