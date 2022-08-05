const bananojs = require("bananojs");
const axios = require("axios").default;

const kjs = {
    bananojs: bananojs,
    _config: {
        "node-rpc-url": "http://node.bananoplanet.cc:7072",
        "work-server-url": "https://mynano.ninja/api/node",
        "rep-account": "ban_3p1anetee7arfx9zbmspwf9c8c5r88wy6zkgwcbt7rndtcqsoj6fzuy11na3"
    },
    config: (config) => {
        kjs._config = config;
    },
    signWithKey: async (privateKey, hash) => {
        let signature = await bananojs.signHash(privateKey, hash);
        return signature;
    },
    generateWork: async (hash) => {
        if (_config["work-server-url"] != undefined) {
            let response = await axios.post(_config["work-server-url"], {
                "action": "work_generate",
                "hash": hash,
                "difficulty": "fffffff000000000"
            });
            if (response.data["error"]) console.error(response.data["error"]);
            return response.data["work"];
        } else {
            let workBytes = new Uint8Array(8);
            let pow = await bananojs.getWorkUsingCpu(hash, workBytes);
            return pow;
        };
    },
    sendTx: async (privateKey, recipient, amountRaw, previousHash=undefined, rawNewBalance=undefined, rawPreBalance=undefined) => {
        const link = await bananojs.getAccountPublicKey(recipient);
        return kjs.broadcastTx(privateKey, link, amountRaw, previousHash, rawNewBalance, rawPreBalance);
    },
    receiveTx: async (privateKey, link, previousHash=undefined, rawNewBalance=undefined, rawPreBalance=undefined) => {
        return kjs.broadcastTx(privateKey, link, 0, previousHash, rawNewBalance, rawPreBalance);
    },
    broadcastTx: async (privateKey, link, amountRaw, previousHash, rawNewBalance, rawPreBalance) => {
        
        const isSend = amountRaw > 0;

        let publicKey = await bananojs.getPublicKey(privateKey);
        let account = await bananojs.getAccount(publicKey, "ban_");
        
        if (!previousHash || !rawNewBalance) {
            let accountInfo = (await axios.post(kjs._config["node-rpc-url"], {
                "action": "account_info",
                "account": account
            })).data;
            if (isSend) {
                previousHash = previousHash || accountInfo["frontier"] || publicKey;
                rawNewBalance = ((rawPreBalance ? BigInt(rawPreBalance) : (BigInt(accountInfo["balance"] || BigInt("0")))) - BigInt(amountRaw)).toString();
            } else {
                previousHash = previousHash || accountInfo["frontier"] || "0000000000000000000000000000000000000000000000000000000000000000";
                let sendBlock = (await axios.post(kjs._config["node-rpc-url"], {  
                    "action": "block_info",
                    "json_block": "true",
                    "hash": link
                })).data;
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
            pow = await kjs.generateWork(previousHash);
        } else {
            pow = await kjs.generateWork(
                previousHash == "0000000000000000000000000000000000000000000000000000000000000000" ?
                publicKey : previousHash
            );
        }
    
        let response = await axios.post(kjs._config["node-rpc-url"], {
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
        });
    
        if (response.data["error"]) console.error(response.data["error"]);

        return [response.data["hash"], rawNewBalance];

    },
    getReceivable: async (account, threshold="1000000000000000000000000000") => {
        return (await axios.post(kjs._config["node-rpc-url"], {
            "action": "receivable",
            "account": account,
            "threshold": threshold
        })).data["blocks"];
    },
    receiveList: async (privateKey, hashes, previousHash=undefined, rawNewBalance=undefined) => {
        receivedHashes = [];
        for (const hash of Object.keys(hashes)) {
            let tx = await kjs.receiveHash(privateKey, hash, previousHash, undefined, rawNewBalance);
            previousHash = tx[0];
            rawNewBalance = tx[1];
            receivedHashes.push(previousHash);
        };
        return [receivedHashes, rawNewBalance];
    }
};

module.exports = kjs;