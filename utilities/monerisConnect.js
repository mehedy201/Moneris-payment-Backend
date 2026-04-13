// const braintree = require("braintree");

// let gateway = null;

// module.exports = {
//   connectToBraintree: function () {
//     try {
//       gateway = new braintree.BraintreeGateway({
//         environment: braintree.Environment.Production,
//         merchantId: process.env.BT_MERCHANT_ID,
//         publicKey: process.env.BT_PUBLIC_KEY,
//         privateKey: process.env.BT_PRIVATE_KEY,
//       });
//       console.log("✅ Successfully connected to Braintree.");
//     } catch (err) {
//       console.error("❌ Error connecting to Braintree:", err);
//       throw err;
//     }
//   },

//   braintreeGateway: function () {
//     if (!gateway) {
//       throw new Error("Braintree not initialized. Call connectToBraintree first.");
//     }
//     return gateway;
//   },
// };


const axios = require("axios");

let monerisConfig = null;

module.exports = {
  connectToMoneris: function () {
    try {
      // Store credentials from environment variables
      monerisConfig = {
        store_id: process.env.MONERIS_STORE_ID,
        api_token: process.env.MONERIS_API_TOKEN,
        checkout_id: process.env.MONERIS_CHECKOUT_ID,
        // Environment: 'qa' for testing, 'prod' for live
        host: process.env.NODE_ENV === "production" 
          ? "https://gateway.moneris.com" 
          : "https://gatewayt.moneris.com"
      };
      console.log("✅ Moneris configuration initialized.");
    } catch (err) {
      console.error("❌ Error initializing Moneris:", err);
      throw err;
    }
  },

  // Helper to make the "Preload Request" (similar to generating a Braintree client token)
  generateCheckoutTicket: async function (orderData) {
    if (!monerisConfig) throw new Error("Moneris not initialized.");

    const payload = {
      store_id: monerisConfig.store_id,
      api_token: monerisConfig.api_token,
      checkout_id: monerisConfig.checkout_id,
      txn_total: orderData.amount,
      order_no: orderData.orderId,
      action: "preload",
      environment: process.env.NODE_ENV === "production" ? "prod" : "qa"
    };

    try {
      const response = await axios.post(`${monerisConfig.host}/chkt/request/request.php`, payload);
      return response.data.response.ticket; // Use this ticket on your frontend
    } catch (err) {
      console.error("Moneris Preload Error:", err);
      throw err;
    }
  }
};
