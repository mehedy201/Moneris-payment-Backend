const { MongoClient, ServerApiVersion } = require("mongodb");
const Db = process.env.ATLAS_URI;
console.log('atlas ari', Db)

const client = new MongoClient(Db, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true
  }
});

let _db;

module.exports = {
  connectToServer: async function () {
    try {
      await client.connect();
      _db = client.db("EventTicketsSalesINFO");
      console.log("✅ Successfully connected to MongoDB.");
    } catch (err) {
      console.error("❌ Error connecting to MongoDB:", err);
      throw err;
    }
  },

  getDb: function () {
    if (!_db) {
      throw new Error("Database not initialized. Call connectToServer first.");
    }
    return _db;
  },
};
