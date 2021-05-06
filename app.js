let express = require("express");
let { MongoClient, Double } = require("mongodb");

require("dotenv").config();

let app = express();
let port = process.env.PORT || 8080;

app.listen(port);

let uri = "mongodb://127.0.0.1:27017"
let mongoClient = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

let reqScheduler = new (require("./requestScheduler.js").RequestScheduler)(500)

async function getProfileIds() { //get lowest bin price for auctions
    let auctionData = {
        timestamp: Date.now(),
        items: {}
    }
    console.log("Fetching Auction Data...")
    let auctionApi = (await reqScheduler.get(`https://api.hypixel.net/skyblock/auctions?key=${process.env.API_KEY}`)).data;
    for (let page = 0; page < auctionApi.totalPages; page++) {
        console.log(`Fetching Auction Data... (${page+1}/${auctionApi.totalPages})`);
        let auctionPageApi = (await reqScheduler.get(`https://api.hypixel.net/skyblock/auctions?key=${process.env.API_KEY}&page=${page}`)).data.auctions; //get auction api for current page
        auctionPageApi.forEach((auction) => {
            if (!heldProfileIds.has(auction.profile_id)) newProfileIds.add(auction.profile_id)
        }); //add newly found profile ids to the array
        //get lowest bins and add to map
    }
}


async function getNewProfile() {
    let profileId = newProfileIds.values().next().value;
    let profileApi = (await reqScheduler.get(`https://api.hypixel.net/skyblock/profile?key=${process.env.API_KEY}&profile=${profileId}`)).data.profile;
    if (!profileApi) return;
    for (let uuid in profileApi.members) { //iterate through all players attached to the coop
        let player = profileApi.members[uuid];
        //exclude players who dont have a stats field, skill api enabled, or dont have any catacombs completions
        if ( !(checkNested(player, "stats") && checkNested(player, "dungeons", "dungeon_types", "catacombs", "tier_completions") && checkNested(player, "experience_skill_taming")) ) continue;
        let snapshot = {
            uuid,
            profile_id: profileId,
            timestamp: new Date(Date.now()),
            stats: player.stats,
            purse: Math.round(player.coin_purse),
            first_join: new Date(player.first_join) ,
            last_death: player.last_death,
            fairy_souls: player.fairy_souls_collected || 0,
            slayer: player.slayer_bosses,
            pets: buildPetsObj(player.pets),
            farming_contest: {
                contests_played: checkNested(player, "jacob2", "contests") ? Object.keys(player.jacob2.contests).length : 0,
                unique_golds: checkNested(player, "jacob2", "unique_golds2") ? player.jacob2.unique_golds2.length : 0,  
            },
            catacombs: {
                times_played: player.dungeons.dungeon_types.catacombs.times_played,
                tier_completions: player.dungeons.dungeon_types.catacombs.tier_completions,
                experience: player.dungeons.dungeon_types.catacombs.experience,
                fastest_time: player.dungeons.dungeon_types.catacombs.fastest_time
            },
            dungeons: checkNested(player, "dungeons") ? player.dungeons.player_classes : undefined,
            skills: {
                taming: player.experience_skill_taming,
                farming: player.experience_skill_farming,
                mining: player.experience_skill_mining,
                combat: player.experience_skill_combat,
                foraging: player.experience_skill_foraging,
                fishing: player.experience_skill_fishing,
                enchanting: player.experience_skill_enchanting,
                alchemy: player.experience_skill_alchemy,
                carpentry: player.experience_skill_carpentry,
                runecrafting: player.experience_skill_runecrafting
            }
        }
        
        //fix .catacombs
        snapshot.catacombs.experience = Double(snapshot.catacombs.experience)
        for (let floor in snapshot.catacombs.tier_completions) {
            snapshot.catacombs.tier_completions[floor] = snapshot.catacombs.tier_completions[floor] || 0;
        }
        for (let floor in snapshot.catacombs.times_played) {
            snapshot.catacombs.times_played[floor] = snapshot.catacombs.times_played[floor] || 0;
        }

        snapshotCollection.replaceOne({uuid: uuid}, snapshot, {upsert: true});
    }
    newProfileIds.delete(profileId);
    heldProfileIds.add(profileId);
}

const pet_types = ["MITHRIL_GOLEM", "GRANDMA_WOLF", "MEGALODON", "GRIFFIN", "BAT", "BLAZE", "CHICKEN", "HORSE", "JERRY", "OCELOT", "PIGMAN", "RABBIT", "SHEEP", "SILVERFISH", "WITHER_SKELETON", "SKELETON_HORSE", "WOLF", "ENDERMAN", "PHOENIX", "MAGMA_CUBE", "FLYING_FISH", "BLUE_WHALE", "TIGER", "LION", "PARROT", "SNOWMAN", "TURTLE", "BEE", "ENDER_DRAGON", "GUARDIAN", "SQUID", "GIRAFFE", "ELEPHANT", "MONKEY", "SPIDER", "ENDERMITE", "GHOUL", "JELLYFISH", "PIG", "ROCK", "SKELETON", "ZOMBIE", "DOLPHIN", "BABY_YETI", "GOLEM", "HOUND", "TARANTULA", "BLACK_CAT", "SPIRIT"];
const pet_tiers = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"]

function checkNested(obj, level,  ...rest) {
    if (obj === undefined) return false
    if (rest.length == 0 && obj.hasOwnProperty(level)) return true
    return checkNested(obj[level], ...rest)
}

function buildPetsObj(pets) {
    let out = {};
    for (let type of pet_types) {
        for (let tier of pet_tiers) {
            out[`${type}_${tier}`] = 0; //store booleans numerically so I can easier do stuff with the data
        }
    }
    for (let pet of pets || []) {
        out[`${pet.type}_${pet.tier}`] = 1;
    }
    return out;
}

var snapshotCollection;
var heldProfileIds = new Set();
var newProfileIds = new Set();

(async () => {
    await mongoClient.connect();
    console.log("connected to db")
    snapshotCollection = mongoClient.db("skyblock-data").collection("Snapshots");
    //dont re-get profiles within the day
    (await snapshotCollection.find({timestamp: {$gt: new Date(Date.now() - 1000 * 60 * 60 * 24)}}).toArray()).forEach(snapshot => heldProfileIds.add(snapshot.profile_id));
    console.log("updated heldProfileIds");
    setInterval(() => console.log(`total unique profile ids access in last 24 hrs: ${heldProfileIds.size}\ntotal unique profile ids pending: ${newProfileIds.size}`), 1000 * 60)
    
    while (true) { //lol
        if (newProfileIds.size > 0) {
            await getNewProfile();
        } else {
            console.log("fetching new profile ids...")
            await getProfileIds();
        }
    }
})()

