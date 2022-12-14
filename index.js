const bananojs = require("@bananocoin/bananojs");
const axios = require("axios").default;

const kjs = {
    _config: {
        "node-rpc-url": "http://node.bananoplanet.cc:7072",
        "work-server-url": "http://0.tcp.ngrok.io:12953",
        "bpow-server-url": "https://boompow.banano.cc/graphql",
        "rep-account": "ban_3p1anetee7arfx9zbmspwf9c8c5r88wy6zkgwcbt7rndtcqsoj6fzuy11na3",
        "enabled-pow-methods": ["bpow", "ws", "cpu"]
    },
    config: (config) => {
        Object.keys(config).forEach(k => {
            kjs._config[k] = config[k];
        });
    },
    postToRPC: async (payload) => {
        let response = await axios.post(kjs._config["node-rpc-url"], payload);
        if (response.data["error"]) console.error(payload, "RPC error: " + response.data["error"]);
        return response.data;
    },
    generateWorkCPU: async (hash) => {
        if (!kjs._config["enabled-pow-methods"].includes("cpu")) return "0";
        console.log("Generating work with CPU...");
        let workBytes = new Uint8Array(8);
        let pow = await bananojs.getWorkUsingCpu(hash, workBytes);
        return pow;
    },
    generateWorkWS: async (hash) => {
        if (!kjs._config["enabled-pow-methods"].includes("ws")) return await kjs.generateWorkCPU(hash);
        console.log("Generating work with work server...");
        try {
            let response = await axios.post(kjs._config["work-server-url"], {
                "action": "work_generate",
                "hash": hash,
                "difficulty": "fffffff000000000"
            });
            if (response.data["error"]) console.error(hash, "Work server error: " + response.data["error"]);
            return response.data["work"];
        } catch(err) {
            console.error(hash, "Work server error: " + err.toString());
            return await kjs.generateWorkCPU(hash);
        };
    },
    generateWork: async (hash, bpowAuthKey="", difficultyMultiplier=1) => {
        if (!kjs._config["enabled-pow-methods"].includes("bpow")) return await kjs.generateWorkWS(hash);
        console.log("Generating work with BoomPoW...");
        try {
            let response = await axios.post(kjs._config["bpow-server-url"], {
                "query": `mutation workGenerate{\n  workGenerate(input:{hash:"${hash}", difficultyMultiplier:${difficultyMultiplier}})}\n`,
                "variables": null,
                "operationName": "workGenerate"
            }, { headers: { "Authorization": bpowAuthKey } });
            if (response.data["errors"]) {
                console.error(hash, "BPoW error: " + response.data["errors"][0]["message"]);
                return await kjs.generateWorkWS(hash);
            } else {
                return response.data["data"]["workGenerate"];
            }
        } catch(err) {
            console.error(hash, "BPoW error: " + err.toString());
            return await kjs.generateWorkWS(hash);
        }
    },
    signWithKey: async (privateKey, hash) => {
        let signature = await bananojs.signHash(privateKey, hash);
        return signature;
    },
    sendTx: async (privateKey, recipient, amountRaw, previousHash=undefined, rawNewBalance=undefined, rawPreBalance=undefined, bpowAuthKey="", difficultyMultiplier=1) => {
        if (amountRaw == "0") return console.error("sendTx: Cannot send 0 raw");
        const link = await bananojs.getAccountPublicKey(recipient);
        return kjs.broadcastTx(privateKey, link, amountRaw, previousHash, rawNewBalance, rawPreBalance, bpowAuthKey, difficultyMultiplier);
    },
    receiveTx: async (privateKey, link, previousHash=undefined, rawNewBalance=undefined, rawPreBalance=undefined, bpowAuthKey="", difficultyMultiplier=1) => {
        return kjs.broadcastTx(privateKey, link, 0, previousHash, rawNewBalance, rawPreBalance, bpowAuthKey, difficultyMultiplier);
    },
    broadcastTx: async (privateKey, link, amountRaw, previousHash, rawNewBalance, rawPreBalance, bpowAuthKey, difficultyMultiplier) => {
        
        const isSend = amountRaw > 0;

        let publicKey = await bananojs.getPublicKey(privateKey);
        let account = await bananojs.getAccount(publicKey, "ban_");
        
        if (!previousHash || !rawNewBalance) {
            let accountInfo = await kjs.postToRPC({
                "action": "account_info",
                "account": account
            });
            if (isSend) {
                previousHash = previousHash || accountInfo["frontier"] || publicKey;
                rawNewBalance = ((rawPreBalance ? BigInt(rawPreBalance) : (BigInt(accountInfo["balance"] || BigInt("0")))) - BigInt(amountRaw)).toString();
            } else {
                previousHash = previousHash || accountInfo["frontier"] || "0000000000000000000000000000000000000000000000000000000000000000";
                let sendBlock = await kjs.postToRPC({  
                    "action": "block_info",
                    "json_block": "true",
                    "hash": link
                });
                rawNewBalance = ((rawPreBalance ? BigInt(rawPreBalance) : (BigInt(accountInfo["balance"] || BigInt("0")))) + BigInt(sendBlock["amount"])).toString();    
            }
        };
    
        let hash = await bananojs.getBlockHash({
            "type": "state",
            "account": account,
            "previous": previousHash,
            "representative": kjs._config["rep-account"],
            "balance": rawNewBalance,
            "link": link,
        });
    
        let signature = await kjs.signWithKey(privateKey, hash);
        let pow;
        if (isSend) {
            pow = await kjs.generateWork(previousHash, bpowAuthKey, difficultyMultiplier);
        } else {
            pow = await kjs.generateWork(
                previousHash == "0000000000000000000000000000000000000000000000000000000000000000" ? publicKey : previousHash,
                bpowAuthKey,
                difficultyMultiplier
            );
        }

        if (pow === "0") {
            console.log("PoW generation failed");
            return [undefined, rawPreBalance];
        };
    
        let responseHash = (await kjs.postToRPC({
            "action": "process",
            "json_block": "true",
            "subtype": isSend ? "send" : "receive",
            "block": {
                "type": "state",
                "account": account,
                "previous": previousHash,
                "representative": kjs._config["rep-account"],
                "balance": rawNewBalance,
                "link": link,
                "signature": signature,
                "work": pow
            }
        }))["hash"];
    
        return [responseHash, rawNewBalance];

    },
    getReceivable: async (account, threshold="1") => {
        return (await kjs.postToRPC({
            "action": "receivable",
            "account": account,
            "threshold": threshold
        }))["blocks"];
    },
    receiveList: async (privateKey, hashes, previousHash=undefined, rawNewBalance=undefined, rawPreBalance=undefined) => {
        receivedHashes = [];
        for (const hash of hashes) {
            let tx = await kjs.receiveTx(privateKey, hash, previousHash, rawNewBalance, rawPreBalance);
            previousHash = tx[0];
            rawPreBalance = tx[1];
            receivedHashes.push(previousHash);
        };
        return [receivedHashes, rawPreBalance];
    },
    getAccountBalance: async (account) => {
        return (await kjs.postToRPC({
            "action": "account_balance",
            "account": account
        }));
    }
};

module.exports = kjs;