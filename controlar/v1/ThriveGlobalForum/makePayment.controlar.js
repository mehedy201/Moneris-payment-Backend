const { ObjectId } = require("mongodb");
const { getDb } = require("../../../utilities/dbConnect");
const { transporter } = require("../../../utilities/nodeMailerConnect");
const puppeteer = require("puppeteer");
const ejs = require("ejs");
const fs = require("fs");
const path = require("path");
const localDate = require("../../../hooks/loacalDate");
const ExcelJS = require("exceljs");

module.exports.getMonerisTicket = async (req, res) => {
  const db = getDb();
  try {
    console.log("🟡 [STEP 4] getMonerisTicket controller");
    console.log("🟡 [STEP 4] Query params:", req.query);

    const {
      generateCheckoutTicket,
    } = require("../../../utilities/monerisConnect");

    const {
      lowTicketsQuantity,
      fullTicketsQuantity,
      corporateTicketsQuantity,
      studentTicketsQuantity,
      cuponCode,
    } = req.query;

    const lowPrice = 440;
    const fullPrice = 450;
    const corpPrice = 500;
    const studentPrice = 350;
    const taxRate = 0.15;

    const totalTickets =
      Number(lowTicketsQuantity) +
      Number(fullTicketsQuantity) +
      Number(studentTicketsQuantity) +
      Number(corporateTicketsQuantity);

    console.log("🟡 [STEP 4] Total tickets:", totalTickets);

    if (totalTickets <= 0) {
      console.error("❌ [STEP 4] কোনো ticket select করা হয়নি");
      return res.status(400).json({ error: "No tickets selected" });
    }

    let totalPrice =
      lowTicketsQuantity * lowPrice +
      fullTicketsQuantity * fullPrice +
      studentTicketsQuantity * studentPrice +
      corporateTicketsQuantity * corpPrice;

    console.log("🟡 [STEP 5] Total price (tax ছাড়া):", totalPrice);

    const taxAmount = +(totalPrice * taxRate).toFixed(2);
    let totalWithTax = +(totalPrice + taxAmount).toFixed(2);

    console.log("🟡 [STEP 5] Tax amount:", taxAmount);
    console.log("🟡 [STEP 5] Total with tax:", totalWithTax);

    let groupDiscount = 0;
    if (totalTickets > 1) {
      groupDiscount = +(totalWithTax * 0.1).toFixed(2);
      totalWithTax -= groupDiscount;
      console.log("🟡 [STEP 5] Group discount applied:", groupDiscount);
    }

    let couponDiscount = 0;
    if (cuponCode === "Malik03") {
      couponDiscount = 456;
      totalWithTax -= couponDiscount;
      console.log("🟡 [STEP 5] Coupon discount applied:", couponDiscount);
    }

    if (totalWithTax < 1) {
      totalWithTax = 1.0;
      console.log("🟡 [STEP 5] Minimum amount enforced: 1.00");
    }

    const payAblePrice = +totalWithTax.toFixed(2);
    const orderId = "TGF-" + Date.now();

    console.log("✅ [STEP 5] Final payable amount:", payAblePrice);
    console.log("✅ [STEP 5] Generated orderId:", orderId);

    const formattedAmount = payAblePrice.toFixed(2);

    console.log("🟡 [STEP 6] generateCheckoutTicket কে call করা হচ্ছে...");

    const ticket = await generateCheckoutTicket({
      amount: formattedAmount,
      orderId,
    });

    console.log("✅ [STEP 6] Ticket পাওয়া গেছে:", ticket);

    const attemptedPayment = {
      ticket,
      orderId,
      amount: payAblePrice,
      status: "Attempted Payment",
      date: new Date(),
    };

    await db
      .collection("iccpc_2027-Attempted-Payments")
      .insertOne(attemptedPayment);

    res.status(200).json({ ticket, orderId, amount: payAblePrice });
  } catch (error) {
    console.error(
      "❌ [STEP 6] getMonerisTicket controller এ error:",
      error.message,
    );
    res.status(500).json({ error: "Failed to generate ticket" });
  }
};

// ______________________________________________________________________
// Get iccpc_2027 Ticket Payment______________________________________________
// ______________________________________________________________________

const templatePath = path.join(__dirname, "views", "attendees-email.ejs");
const htmlTemplate = fs.readFileSync(templatePath, "utf-8");
const sendEmailToAttendee = async (attendee) => {
  try {
    const htmlContent = ejs.render(htmlTemplate, {
      firstName: attendee.firstName,
      id: attendee._id,
    });

    const info = await transporter.sendMail({
      from: `'ICCPC' ${process.env.NODE_MAILER_USER_EMAIL}`,
      to: attendee.email,
      subject:
        "Acknowledgement of Registration-3rd International Conference on Business Health and Climate.",
      html: htmlContent,
    });

    console.log(`✅ Email sent to ${attendee.email}: ${info.response}`);
  } catch (err) {
    console.error(`❌ Email failed to ${attendee.email}:`, err.message);
  }
};

module.exports.verifyMonerisPayment = async (req, res) => {
  console.log("🟡 [STEP 1] verifyMonerisPayment শুরু হয়েছে");
  console.log("🟡 [STEP 1] Body:", JSON.stringify(req.body, null, 2));

  const {
    ticket,
    orderId,
    lowTicketsQuantity,
    fullTicketsQuantity,
    corporateTicketsQuantity,
    studentTicketsQuantity,
    cuponCode,
    purcherAttendeesData,
  } = req.body;

  console.log("purcherAttendeesData=========", purcherAttendeesData);

  if (!ticket || !orderId) {
    console.error("❌ [STEP 1] Ticket বা OrderId missing");
    return res.status(400).json({
      success: false,
      message: "Missing ticket or orderId",
    });
  }

  const db = getDb();
  const session = db.client.startSession();

  try {
    const {
      verifyCheckoutReceipt,
    } = require("../../../utilities/monerisConnect");

    /* ================================================
    STEP 2: VERIFY RECEIPT
    payment complete না হলে এখানেই বন্ধ
    ================================================ */
    console.log("🟡 [STEP 2] Receipt verify করা হচ্ছে...");

    let receipt;
    try {
      receipt = await verifyCheckoutReceipt(ticket);
    } catch (verifyError) {
      console.error("❌ [STEP 2] Verify failed:", verifyError.message);
      return res.status(400).json({
        success: false,
        message: verifyError.message || "Payment not approved",
      });
    }

    console.log("✅ [STEP 2] Receipt:", JSON.stringify(receipt, null, 2));
    console.log("✅ [STEP 2] Payment approved!");

    /* ================================================
STEP 3: CALCULATION
================================================ */
    const LOW_PRICE = 440;
    const FULL_PRICE = 450;
    const CORP_PRICE = 500;
    const STUDENT_PRICE = 350;
    const taxRate = 0.15;

    const totalTickets =
      Number(lowTicketsQuantity) +
      Number(fullTicketsQuantity) +
      Number(studentTicketsQuantity) +
      Number(corporateTicketsQuantity);

    if (totalTickets <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid tickets",
      });
    }

    const totalPrice =
      Number(lowTicketsQuantity) * LOW_PRICE +
      Number(fullTicketsQuantity) * FULL_PRICE +
      Number(studentTicketsQuantity) * STUDENT_PRICE +
      Number(corporateTicketsQuantity) * CORP_PRICE;

    const taxAmount = +(totalPrice * taxRate).toFixed(2);
    let totalWithTax = +(totalPrice + taxAmount).toFixed(2);

    console.log("🟡 [STEP 3] totalPrice:", totalPrice);
    console.log("🟡 [STEP 3] taxAmount:", taxAmount);
    console.log("🟡 [STEP 3] totalWithTax:", totalWithTax);

    let groupDiscount = 0;
    if (totalTickets > 1) {
      groupDiscount = +(totalWithTax * 0.1).toFixed(2);
      totalWithTax = +(totalWithTax - groupDiscount).toFixed(2);
      console.log("🟡 [STEP 3] groupDiscount:", groupDiscount);
    }

    let couponDiscount = 0;
    if (cuponCode === "Malik03") {
      couponDiscount = 456;
      totalWithTax = +(totalWithTax - couponDiscount).toFixed(2);
      console.log("🟡 [STEP 3] couponDiscount:", couponDiscount);
    }

    // ✅ Debug — coupon match হচ্ছে কিনা দেখুন
    console.log("🟡 [STEP 3] cuponCode received:", JSON.stringify(cuponCode));
    console.log("🟡 [STEP 3] couponDiscount:", couponDiscount);

    if (totalWithTax < 1) totalWithTax = 1.0;
    const payAblePrice = +totalWithTax.toFixed(2);

    console.log("✅ [STEP 3] payAblePrice:", payAblePrice);

    /* ================================================
STEP 6: ATTENDEE CALCULATION
================================================ */
    const TICKET_PRICE_MAP = {
      "Low and Middle Income Countries": LOW_PRICE,
      "Full Conference Registration": FULL_PRICE,
      Corporate: CORP_PRICE,
      Student: STUDENT_PRICE,
    };

    const enrichedAttendees = purcherAttendeesData.attendees.map(
      (att, index) => {
        const attPrice = TICKET_PRICE_MAP[att.ticketsType] || att.price;

        console.log(
          `🟡 [STEP 6] Attendee ${index + 1} ticketsType:`,
          JSON.stringify(att.ticketsType),
        );
        console.log(`🟡 [STEP 6] Attendee ${index + 1} price:`, attPrice);

        // ✅ Tax — নিজের price এর উপর
        const attTax = +(attPrice * taxRate).toFixed(2);

        // ✅ Group Discount — (price + tax) এর উপর 10%
        const attPriceWithTax = +(attPrice + attTax).toFixed(2);
        const attGroupDiscount =
          groupDiscount > 0 ? +(attPriceWithTax * 0.1).toFixed(2) : 0;

        // ✅ Coupon — সমান ভাগে
        const attCouponShare =
          couponDiscount > 0 ? +(couponDiscount / totalTickets).toFixed(2) : 0;

        let attTotal = +(
          attPriceWithTax -
          attGroupDiscount -
          attCouponShare
        ).toFixed(2);

        if (attTotal < 0) attTotal = 0;
        if (totalTickets === 1) attTotal = payAblePrice;

        const taxDiscountCupon = {
          price: attPrice || 0,
          tax: attTax || 0,
          groupDiscount: attGroupDiscount || 0,
          total: attTotal || 0,
          cuponPrice: attCouponShare || 0,
          cupon: cuponCode || "N/A",
          cuponShare: `${couponDiscount} / ${totalTickets}` || "N/A",
        };

        console.log(`✅ [STEP 6] Attendee ${index + 1}:`, taxDiscountCupon);

        return {
          ticketsType: att.ticketsType,
          price: attPrice,
          firstName: att.firstName,
          lastName: att.lastName,
          email: att.email,
          phone: att.phone || "",
          organizationName: att.organizationName || "",
          restrictions: att.restrictions || "",
          requireVisa: att.requireVisa || "NO",
          passportNumber: att.passportNumber || "",
          passportExpiry: att.passportExpiry || "",
          countryOfPassport: att.countryOfPassport || "",
          purcher: purcherAttendeesData.purcher,
          taxDiscountCupon,
          transactionID: ticket,
          purcherID: null,
          paymentStatus: "Completed",
          createdAt: new Date(),
        };
      },
    );

    /* ================================================
    STEP 7: EMAIL TEMPLATE PREPARE
    Transaction এর বাইরে prepare করো
    ================================================ */
    console.log("🟡 [STEP 7] Email template prepare করা হচ্ছে...");

    const templatePath = path.join(__dirname, "views", "email-template.ejs");
    const htmlTemplate = fs.readFileSync(templatePath, "utf-8");

    console.log("✅ [STEP 7] Template ready!");

    /* ================================================
    STEP 8: TRANSACTION
    DB Save + Email — সব একসাথে
    একটা fail → সব rollback
    ================================================ */
    console.log("🟡 [STEP 8] Transaction শুরু হচ্ছে...");

    let purcherID;
    let attendeesWithIds = [];

    await session.withTransaction(async () => {
      /* —— Purcher Save —— */
      const purcherDetails = {
        totalPrice,
        taxAmount,
        groupDiscount,
        couponDiscount,
        lowTicketsQuantity,
        fullTicketsQuantity,
        corporateTicketsQuantity,
        studentTicketsQuantity,
        totalTickets,
        finalAmount: payAblePrice,
        transactionID: ticket,
        paymentStatus: "Completed",
        purcher: purcherAttendeesData.purcher,
        createdAt: new Date(),
      };

      console.log("🟡 [STEP 8] Purcher save করা হচ্ছে...");

      const insertPurcher = await db
        .collection("iccpc_2027-Tickets-Purcher")
        .insertOne(purcherDetails, { session });

      purcherID = insertPurcher.insertedId;
      console.log("✅ [STEP 8] Purcher saved, ID:", purcherID);

      /* —— Attendees Save —— */
      const attendeesWithPurcherID = enrichedAttendees.map((att) => ({
        ...att,
        purcherID,
      }));

      console.log(
        "🟡 [STEP 8] Attendees save করা হচ্ছে, count:",
        attendeesWithPurcherID.length,
      );

      const insertAttendees = await db
        .collection("iccpc_2027-Tickets-Attendees")
        .insertMany(attendeesWithPurcherID, { session });

      attendeesWithIds = Object.values(insertAttendees.insertedIds).map(
        (id, i) => ({ _id: id, ...attendeesWithPurcherID[i] }),
      );

      /* —— Purcher Update —— */
      await db
        .collection("iccpc_2027-Tickets-Purcher")
        .updateOne(
          { _id: purcherID },
          { $set: { attendees: attendeesWithIds } },
          { session },
        );

      console.log("✅ [STEP 8] DB save complete!");

      /* —— Email Render —— */
      const htmlContent = ejs.render(htmlTemplate, {
        transactionID: ticket,
        totalPrice,
        taxAmount,
        groupDiscount,
        couponDiscount,
        finalAmount: payAblePrice,
        lowTicketsQuantity,
        fullTicketsQuantity,
        corporateTicketsQuantity,
        studentTicketsQuantity,
        attendees: attendeesWithIds,
        purcher: purcherAttendeesData.purcher,
        createdAt: new Date(),
      });

      /* —— Promise.all — সব email একসাথে —— */
      console.log("🟡 [STEP 8] Email পাঠানো হচ্ছে parallel এ...");

      await Promise.all([
        transporter.sendMail({
          from: `'ICCPC' ${process.env.NODE_MAILER_USER_EMAIL}`,
          to: purcherAttendeesData.purcher.email,
          subject: "Registration Confirmation",
          html: htmlContent,
        }),
        transporter.sendMail({
          from: `'ICCPC' ${process.env.NODE_MAILER_USER_EMAIL}`,
          to: "registration@iccpc.ca",
          subject: "New Registration",
          html: htmlContent,
        }),
        ...attendeesWithIds.map((att) => sendEmailToAttendee(att)),
      ]);

      console.log("✅ [STEP 8] সব email sent!");
    });

    console.log("✅ [STEP 8] Transaction complete!");

    /* ================================================
    FINAL RESPONSE
    ================================================ */
    console.log("✅ [FINAL] PurcherID:", purcherID);

    res.status(200).json({
      success: true,
      transactionID: ticket,
      purcherID,
      finalAmount: payAblePrice,
    });
  } catch (error) {
    console.error("❌ [ERROR] Failed:", error.message);
    console.error("❌ [ERROR] Stack:", error.stack);

    res.status(500).json({
      success: false,
      message: "Verification failed",
    });
  } finally {
    await session.endSession();
    console.log("🟡 [FINAL] Session শেষ হয়েছে");
  }
};

module.exports.getPurcherData = async (req, res, next) => {
  try {
    const db = getDb();

    const searchText = req.query.search ? req.query.search.toLowerCase() : "";
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = {};
    if (searchText) {
      query.transactionID = { $regex: searchText, $options: "i" };
    }

    // Fetch filtered data and count
    const [data, filteredCount] = await Promise.all([
      db
        .collection("iccpc_2027-Tickets-Purcher")
        .find(query)
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      db.collection("iccpc_2027-Tickets-Purcher").countDocuments(query),
    ]);

    const totalPages = Math.ceil(filteredCount / limit);

    res.status(200).json({
      data,
      currentPage: page,
      perPage: limit,
      totalCount: filteredCount,
      totalPages,
      message: "iccpc_2027 Purcher DATA",
    });
  } catch (error) {
    next(error);
  }
};
// Get Single Purcher Details ____________________________________________
// _______________________________________________________________________
module.exports.getSinglePurcherDetails = async (req, res, next) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const purcherDetails = await db
      .collection("iccpc_2027-Tickets-Purcher")
      .findOne({ _id: new ObjectId(id) });
    res.send({
      status: 200,
      message: "iccpc_2027 purcher Details",
      data: purcherDetails,
    });
  } catch (error) {
    next(error);
  }
};
// Download Single Purcher Details ________________________________________
// ________________________________________________________________________
module.exports.downloadPurcherDetails = async (req, res, next) => {
  const purcherID = req.params.id;
  const db = getDb();

  try {
    if (!ObjectId.isValid(purcherID)) {
      return res.status(400).send("Invalid purcher ID");
    }

    const purcher = await db.collection("iccpc_2027-Tickets-Purcher").findOne({
      _id: new ObjectId(purcherID),
    });

    console.log("purcher======", purcher);
    if (!purcher) return res.status(404).send("Purcher not found");

    const templatePath = path.join(__dirname, "views", "email-template.ejs");
    const htmlTemplate = fs.readFileSync(templatePath, "utf-8");
    const htmlContent = ejs.render(htmlTemplate, {
      ...purcher,
      createdAt: localDate(purcher.createdAt),
    });

    // const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-gpu",
      ],
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
    await browser.close();

    const fileName = `${purcher.firstName || "purcher"}-details.pdf`;

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": pdfBuffer.length,
    });

    res.send(pdfBuffer);
  } catch (error) {
    console.error("Download Purcher error:", error);
    res.status(500).send("Failed to download Purcher Details");
  }
};
// Download All Purcher Data IN Excel ____________________________________
// _______________________________________________________________________
module.exports.downloadFullPurcherExcel = async (req, res, next) => {
  try {
    const db = getDb();

    const purchers = await db
      .collection("iccpc_2027-Tickets-Purcher")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    if (!purchers.length) {
      return res.status(404).json({ message: "No purcher data found" });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Purcher Summary");

    worksheet.columns = [
      { header: "Purcher ID", key: "id", width: 25 },
      { header: "Purcher Name", key: "name", width: 25 },
      { header: "Email", key: "email", width: 30 },
      { header: "Phone", key: "phone", width: 20 },
      { header: "Total Price", key: "totalPrice", width: 15 },
      { header: "Tax Amount", key: "taxAmount", width: 15 },
      { header: "Group Discount", key: "groupDiscount", width: 18 },
      { header: "Coupon Discount", key: "couponDiscount", width: 18 },
      { header: "Low Tickets", key: "lowTicketsQuantity", width: 15 },
      { header: "Full Tickets", key: "fullTicketsQuantity", width: 15 },
      {
        header: "Corporate Tickets",
        key: "corporateTicketsQuantity",
        width: 18,
      },
      { header: "Final Amount", key: "finalAmount", width: 15 },
      { header: "Transaction ID", key: "transactionID", width: 25 },
      { header: "Payment Status", key: "paymentStatus", width: 15 },
      { header: "Created At", key: "createdAt", width: 25 },
    ];

    purchers.forEach((purcher) => {
      worksheet.addRow({
        id: purcher._id.toString(),
        name: `${purcher.purcher?.firstName || ""} ${purcher.purcher?.lastName || ""}`,
        email: purcher.purcher?.email || "",
        phone: purcher.purcher?.phone || "",
        totalPrice: purcher.totalPrice || 0,
        taxAmount: purcher.taxAmount || 0,
        groupDiscount: purcher.groupDiscount || 0,
        couponDiscount: purcher.couponDiscount || 0,
        lowTicketsQuantity: purcher.lowTicketsQuantity || 0,
        fullTicketsQuantity: purcher.fullTicketsQuantity || 0,
        corporateTicketsQuantity: purcher.corporateTicketsQuantity || 0,
        finalAmount: purcher.finalAmount || 0,
        transactionID: purcher.transactionID || "",
        paymentStatus: purcher.paymentStatus || "",
        createdAt: purcher.createdAt
          ? new Date(purcher.createdAt).toLocaleString()
          : "",
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=purcher-summary-${Date.now()}.xlsx`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Excel generation error:", error);
    res.status(500).json({ message: "Failed to generate Excel file" });
  }
};

// _______________________________________________________________________
// Download Attendees Tickets ____________________________________________
// _______________________________________________________________________
module.exports.downloadAttendeesTickets = async (req, res, next) => {
  const attendeeId = req.params.id;
  const db = getDb();

  try {
    if (!ObjectId.isValid(attendeeId)) {
      return res.status(400).send("Invalid attendee ID");
    }

    const attendee = await db
      .collection("iccpc_2027-Tickets-Attendees")
      .findOne({
        _id: new ObjectId(attendeeId),
      });

    console.log("attendee======", attendee);

    if (!attendee) return res.status(404).send("Attendee not found");
    const templatePath = path.join(__dirname, "views", "ticket-template.ejs");
    const htmlTemplate = fs.readFileSync(templatePath, "utf-8");

    //logo path
    const logoPath = path.join(__dirname, "views", "logo.jpg");
    const logoData = fs.readFileSync(logoPath).toString("base64");
    const logo = `data:image/jpeg;base64,${logoData}`;
    const html = ejs.render(htmlTemplate, {
      attendee,
      logo,
      createdAt: localDate(attendee.createdAt),
    });

    // const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-gpu",
      ],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
    await browser.close();

    const fileName = `${attendee.firstName || "attendee"}-ticket.pdf`;

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": pdfBuffer.length,
    });

    res.send(pdfBuffer);
  } catch (error) {
    console.error("Download ticket error:", error);
    res.status(500).send("Failed to download ticket");
  }
};
// Get Attendees DATA ____________________________________________________
// _______________________________________________________________________
module.exports.getAttendeesData = async (req, res, next) => {
  try {
    const db = getDb();

    const searchText = req.query.search ? req.query.search.toLowerCase() : "";
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = {};
    if (searchText) {
      query.transactionID = { $regex: searchText, $options: "i" };
    }

    // Fetch filtered data and count
    const [data, filteredCount] = await Promise.all([
      db
        .collection("iccpc_2027-Tickets-Attendees")
        .find(query) // ✅ use the query here
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      db.collection("iccpc_2027-Tickets-Attendees").countDocuments(query),
    ]);

    const totalPages = Math.ceil(filteredCount / limit);

    res.status(200).json({
      data,
      currentPage: page,
      perPage: limit,
      totalCount: filteredCount,
      totalPages,
      message: "iccpc_2027 Attendees DATA",
    });
  } catch (error) {
    next(error);
  }
};
// Download All Attendees Data IN Excel __________________________________
// _______________________________________________________________________
module.exports.downloadFullAttendeesExcel = async (req, res, next) => {
  try {
    const db = getDb();
    const attendees = await db
      .collection("iccpc_2027-Tickets-Attendees")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    if (!attendees.length) {
      return res.status(404).json({ message: "No attendees found" });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Attendees");

    // Define columns (1 row = 1 attendee)
    worksheet.columns = [
      { header: "First Name", key: "firstName", width: 20 },
      { header: "Last Name", key: "lastName", width: 20 },
      { header: "Email", key: "email", width: 25 },
      { header: "Phone", key: "phone", width: 15 },
      { header: "Ticket Type", key: "ticketsType", width: 25 },
      { header: "Price", key: "price", width: 10 },
      { header: "Tax", key: "tax", width: 10 },
      { header: "Group Discount", key: "groupDiscount", width: 15 },
      { header: "Total Amount", key: "total", width: 15 },
      { header: "Cupon Code", key: "cupon", width: 15 },
      { header: "Transaction ID", key: "transactionID", width: 25 },
      { header: "Payment Status", key: "paymentStatus", width: 15 },
      { header: "Require Visa", key: "requireVisa", width: 10 },
      { header: "Country of Passport", key: "countryOfPassport", width: 20 },
      { header: "Passport Number", key: "passportNumber", width: 20 },
      { header: "Passport Expiry", key: "passportExpiry", width: 20 },
      { header: "Restrictions", key: "restrictions", width: 30 },
      { header: "Registration Date", key: "createdAt", width: 25 },
      { header: "Purcher Email", key: "purcherEmail", width: 25 },
      { header: "Purcher Name", key: "purcherName", width: 25 },
    ];

    // Add each attendee row
    attendees.forEach((att) => {
      worksheet.addRow({
        firstName: att.firstName || "",
        lastName: att.lastName || "",
        email: att.email || "",
        phone: att.phone || "",
        ticketsType: att.ticketsType || "",
        price: att.price || "",
        tax: att.taxDiscountCupon?.tax || "",
        groupDiscount: att.taxDiscountCupon?.groupDiscount || "",
        total: att.taxDiscountCupon?.total || "",
        cupon: att.taxDiscountCupon?.cupon || "",
        transactionID: att.transactionID || "",
        paymentStatus: att.paymentStatus || "",
        requireVisa: att.requireVisa || "",
        countryOfPassport: att.countryOfPassport || "",
        passportNumber: att.passportNumber || "",
        passportExpiry: att.passportExpiry || "",
        restrictions: att.restrictions || "",
        createdAt: new Date(att.createdAt).toLocaleString(),
        purcherEmail: att.purcher?.email || "",
        purcherName: `${att.purcher?.firstName || ""} ${att.purcher?.lastName || ""}`,
      });
    });

    // Set response headers for Excel download
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=attendees-${Date.now()}.xlsx`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Excel Export Error:", error);
    res.status(500).json({ message: "Failed to generate Excel file" });
  }
};
