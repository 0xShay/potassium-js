const bananojs = require("bananojs");
const axios = require("axios").default;

const kjs = {
    bananojs: bananojs,
    _config: {
        "node-rpc-url": "http://node.bananoplanet.cc:7072",
        "work-server-url": "http://0.tcp.ngrok.io:12953",
        "rep-account": "ban_3p1anetee7arfx9zbmspwf9c8c5r88wy6zkgwcbt7rndtcqsoj6fzuy11na3"
    },
    config: (config) => {
        kjs._config = config;
    },
    postToRPC: async (payload) => {
        let response = await axios.post(kjs._config["node-rpc-url"], payload);
        if (response.data["error"]) console.error(payload, "RPC error: " + response.data["error"]);
        return response.data;
    },
    rinseSeed: async (seed, recipient, indexEndIncl, indexStart=0) => {
        let privateKeys = [];
        let accountsList = [];
        let sendTxList = [];
        for (let i = indexStart; i <= indexEndIncl; i++) {    
            const privateKey = bananojs.getPrivateKey(seed, i);
            privateKeys.push(privateKey);
            const publicKey = await bananojs.getPublicKey(privateKey);
            const account = bananojs.getBananoAccount(publicKey);
            accountsList.push(account);
        };
        let accountsBalances = await kjs.postToRPC({
            "action": "accounts_balances",
            "accounts": accountsList
        });
        let accountsPending = await kjs.postToRPC({
            "action": "accounts_pending",
            "accounts": accountsList
        });
        let accountsFrontiers = await kjs.postToRPC({
            "action": "accounts_frontiers",
            "accounts": accountsList
        });
        for (acc of accountsList) {
            // receive all incoming pending transactions
            let pendingTxns = accountsPending["blocks"][acc] || [];
            if (pendingTxns.length > 0) {
                let frontier = accountsFrontiers["frontiers"][acc];
                let rawPreBalance = BigInt(accountsBalances["balances"][acc]["balance"]);
                let rl = await kjs.receiveList(
                    privateKeys[accountsList.indexOf(acc)],
                    pendingTxns,
                    frontier,
                    undefined,
                    rawPreBalance
                );
                accountsFrontiers["frontiers"][acc] = rl[0];
                accountsBalances["balances"][acc]["balance"] = rl[1];
                console.log(`Received for ${acc}:\n${pendingTxns.join("\n")}`);
            };
            // send all to recipient
            if (accountsBalances["balances"][acc]["balance"] != "0") {
                let rinseTx = await kjs.sendTx(
                    privateKeys[accountsList.indexOf(acc)],
                    recipient,
                    accountsBalances["balances"][acc]["balance"],
                    accountsFrontiers["frontiers"][acc],
                    "0",
                    accountsBalances["balances"][acc]["balance"]
                );
                sendTxList.push(rinseTx[0]);
                console.log(`Rinsed ${acc}:\n${rinseTx[0]}`);
            };
        };
        return sendTxList;
    },
    signWithKey: async (privateKey, hash) => {
        let signature = await bananojs.signHash(privateKey, hash);
        return signature;
    },
    generateWork: async (hash) => {
        if (kjs._config["work-server-url"] != undefined) {
            let response = await axios.post(kjs._config["work-server-url"], {
                "action": "work_generate",
                "hash": hash,
                "difficulty": "fffffff000000000"
            });
            if (response.data["error"]) console.error(payload, "RPC error: " + response.data["error"]);
            return response.data["work"];
        } else {
            let workBytes = new Uint8Array(8);
            let pow = await bananojs.getWorkUsingCpu(hash, workBytes);
            return pow;
        };
    },
    sendTx: async (privateKey, recipient, amountRaw, previousHash=undefined, rawNewBalance=undefined, rawPreBalance=undefined) => {
        if (amountRaw == "0") return console.error("sendTx: Cannot send 0 raw");
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
            pow = await kjs.generateWork(previousHash);
        } else {
            pow = await kjs.generateWork(
                previousHash == "0000000000000000000000000000000000000000000000000000000000000000" ?
                publicKey : previousHash
            );
        }
    
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
    getReceivable: async (account, threshold="1000000000000000000000000000") => {
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
    }
};

module.exports = kjs;