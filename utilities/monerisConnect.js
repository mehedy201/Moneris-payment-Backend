const axios = require("axios");

let monerisConfig = null;
let monerisClient = null;

/**
Initialize Moneris connection
Call this once from index.js
*/
function connectToMoneris() {
  try {
    if (
      !process.env.MONERIS_STORE_ID ||
      !process.env.MONERIS_API_TOKEN ||
      !process.env.MONERIS_CHECKOUT_ID
    ) {
      throw new Error("Missing Moneris environment variables");
    }

    // Setup config
    monerisConfig = {
      store_id: process.env.MONERIS_STORE_ID,
      api_token: process.env.MONERIS_API_TOKEN,
      checkout_id: process.env.MONERIS_CHECKOUT_ID,

      host:
        process.env.NODE_ENV === "production"
          ? "https://gateway.moneris.com"
          : "https://gatewayt.moneris.com",

      timeout: 10000,
    };

    // Create axios instance
    monerisClient = axios.create({
      baseURL: `${monerisConfig.host}/chkt/request`,

      timeout: monerisConfig.timeout,

      headers: {
        "Content-Type": "application/json",
      },
    });

    console.log("✅ Moneris connected:", monerisConfig.host);
  } catch (error) {
    console.error("❌ Moneris initialization failed:", error.message);

    throw error;
  }
}

async function generateCheckoutTicket(orderData) {
  try {
    console.log("🟡 [STEP 1] generateCheckoutTicket শুরু হয়েছে");
    console.log("🟡 [STEP 1] orderData:", orderData);

    if (!monerisClient) {
      console.error("❌ [STEP 1] Moneris client initialize হয়নি");
      throw new Error("Moneris not initialized");
    }

    if (!orderData || !orderData.amount || !orderData.orderId) {
      console.error("❌ [STEP 1] Invalid orderData:", orderData);
      throw new Error("Invalid order data");
    }

    const payload = {
      store_id: monerisConfig.store_id,
      api_token: monerisConfig.api_token,
      checkout_id: monerisConfig.checkout_id,
      txn_total: Number(orderData.amount).toFixed(2),
      order_no: orderData.orderId,
      action: "preload",
      environment:
        process.env.NODE_ENV === "production"
          ? "prod"
          : "qa",

      /* =========================================
         FORCE 3DS
      ========================================= */
      threeDSRequestorChallengeInd: "04",
      /* =========================================
         OPTIONAL SECURITY SETTINGS
      ========================================= */
      language: "en",
      dynamic_descriptor: "ICCPC",
    };

    console.log(
      "🟡 [STEP 2] Moneris এ পাঠানো payload:",
      JSON.stringify(payload, null, 2)
    );

    console.log(
      "🟡 [STEP 2] Request URL:",
      `${monerisConfig.host}/chkt/request/request.php`
    );

    const response = await axios.post(
      `${monerisConfig.host}/chkt/request/request.php`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: monerisConfig.timeout,
      }
    );

    console.log(
      "🟡 [STEP 3] Moneris থেকে response আসছে:",
      JSON.stringify(response.data, null, 2)
    );

    if (!response.data?.response?.ticket) {
      console.error(
        "❌ [STEP 3] Ticket পাওয়া যায়নি। Response:",
        response.data
      );

      throw new Error(
        "Invalid Moneris ticket response"
      );
    }

    const ticket = response.data.response.ticket;

    console.log(
      "✅ [STEP 3] Ticket সফলভাবে পাওয়া গেছে:",
      ticket
    );

    console.log(
      "✅ [3DS] Forced 3DS challenge requested"
    );

    return ticket;
  } catch (error) {
    console.error(
      "❌ [STEP 3] generateCheckoutTicket এ error:",
      error.response?.data || error.message
    );

    throw new Error(
      "Failed to generate Moneris ticket"
    );
  }
}

async function verifyCheckoutReceipt(ticket) {
  try {
    console.log("🟡 [VERIFY] verifyCheckoutReceipt শুরু হয়েছে");
    console.log("🟡 [VERIFY] Ticket:", ticket);

    if (!monerisClient) {
      console.error("❌ [VERIFY] Moneris client initialize হয়নি");
      throw new Error("Moneris not initialized");
    }

    if (!ticket) {
      console.error("❌ [VERIFY] Ticket missing");
      throw new Error("Missing ticket");
    }

    const payload = {
      store_id: monerisConfig.store_id,
      api_token: monerisConfig.api_token,
      checkout_id: monerisConfig.checkout_id,
      ticket,
      action: "receipt",
      environment: process.env.NODE_ENV === "production" ? "prod" : "qa",
    };

    console.log("🟡 [VERIFY] Payload:", payload);

    const response = await axios.post(
      `${monerisConfig.host}/chkt/request/request.php`,
      payload,
      {
        headers: { "Content-Type": "application/json" },
        timeout: monerisConfig.timeout,
      }
    );

    console.log("🟡 [VERIFY] Full response:", JSON.stringify(response.data, null, 2));

    if (!response.data?.response) {
      console.error("❌ [VERIFY] Invalid response");
      throw new Error("Invalid receipt response");
    }

    const responseData = response.data.response;

    // ✅ receipt এর ভেতরে cc এর ভেতরে result আছে
    const receipt = responseData.receipt;
    const ccReceipt = receipt?.cc;

    console.log("🟡 [VERIFY] receipt:", JSON.stringify(receipt, null, 2));
    console.log("🟡 [VERIFY] ccReceipt:", JSON.stringify(ccReceipt, null, 2));
    console.log("🟡 [VERIFY] result:", ccReceipt?.result);

    if (!ccReceipt || ccReceipt.result !== "a") {
      console.error("❌ [VERIFY] Not approved, result:", ccReceipt?.result);
      throw new Error("Payment not approved");
    }

    console.log("✅ [VERIFY] Payment verified!");

    // ✅ ccReceipt return করো — controller এ এটাই use হবে
    return {
      result: ccReceipt.result,
      order_no: ccReceipt.order_no,
      transaction_no: ccReceipt.transaction_no,
      reference_no: ccReceipt.reference_no,
      amount: ccReceipt.amount,
      approval_code: ccReceipt.approval_code,
      card_type: ccReceipt.card_type,
      first6last4: ccReceipt.first6last4,
    };

    console.log("3DS cavv:", ccReceipt?.cavv);
    console.log("3DS eci:", ccReceipt?.eci);
    console.log("3DS transStatus:", ccReceipt?.transStatus);

  } catch (error) {
    console.error("❌ [VERIFY] Error:", error.response?.data || error.message);
    throw new Error(error.message || "Failed to verify payment");
  }
}

module.exports = {
  connectToMoneris,
  generateCheckoutTicket,
  verifyCheckoutReceipt,
};
