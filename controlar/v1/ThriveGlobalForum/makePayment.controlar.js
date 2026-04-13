const { ObjectId } = require("mongodb");
const { braintreeGateway } = require("../../../utilities/monerisConnect");
const { getDb } = require("../../../utilities/dbConnect");
const { transporter } = require("../../../utilities/nodeMailerConnect");
const puppeteer = require("puppeteer");
const ejs = require("ejs");
const fs = require("fs");
const path = require("path");
const localDate = require("../../../hooks/loacalDate");
const ExcelJS = require("exceljs");

// Get Braintree Token_____________________________________________________
// ________________________________________________________________________
module.exports.getBraintreeToken = async (req, res, next) => {
  try {
    const gateway = braintreeGateway();
    const response = await gateway.clientToken.generate({});
    res.send({ clientToken: response.clientToken });
  } catch (err) {
    res.status(500).send({ error: "Failed to generate client token" });
  }
};

// ______________________________________________________________________
// Get ThriveGlobalForum Ticket Payment______________________________________________
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
      from: `'Thrive Global Forum' ${process.env.NODE_MAILER_USER_EMAIL}`,
      to: attendee.email,
      subject:
        "Acknowledgement of Registration-International Conference on Entrepreneurship, Health and Climate",
      html: htmlContent,
    });

    console.log(`✅ Email sent to ${attendee.email}: ${info.response}`);
  } catch (err) {
    console.error(`❌ Email failed to ${attendee.email}:`, err.message);
  }
};

module.exports.getThriveGlobalForumpaymentsFromEventTickets = async (
  req,
  res,
) => {
  const {
    nonce,
    lowTicketsQuantity,
    fullTicketsQuantity,
    corporateTicketsQuantity,
    cuponCode,
    purcherAttendeesData,
  } = req.body;

  const db = getDb();
  const session = db.client.startSession();

  try {
    // 1. Validate and calculate price server-side
    const lowPrice = 400,
      fullPrice = 450,
      corpPrice = 500,
      taxRate = 0.15;

    const totalTickets =
      lowTicketsQuantity + fullTicketsQuantity + corporateTicketsQuantity;
    if (totalTickets <= 0)
      return res.status(400).json({ error: "No tickets selected" });

    let totalPrice =
      lowTicketsQuantity * lowPrice +
      fullTicketsQuantity * fullPrice +
      corporateTicketsQuantity * corpPrice;

    const taxAmount = +(totalPrice * taxRate).toFixed(2);

    let totalWithTax = +(totalPrice + taxAmount).toFixed(2);

    // Group discount
    let groupDiscount = 0;
    if (totalTickets > 1) {
      groupDiscount = +(totalWithTax * 0.1).toFixed(2);
      totalWithTax -= groupDiscount;
    }

    // Coupon discount
    let couponDiscount = 0;
    if (cuponCode === "Malik03") {
      couponDiscount = 459;
      totalWithTax -= couponDiscount;
    }

    if (totalWithTax < 1) totalWithTax = 1.0;

    const payAblePrice = +totalWithTax.toFixed(2);

    // 2. Process payment
    const gateway = braintreeGateway();
    const paymentResult = await gateway.transaction.sale({
      amount: payAblePrice.toFixed(2),
      paymentMethodNonce: nonce,
      options: {
        submitForSettlement: true,
        threeDSecure: { required: true },
      },
    });

    if (!paymentResult.success)
      return res
        .status(400)
        .json({ success: false, message: paymentResult.message });

    // 3. MongoDB transaction for Purcher & Attendees save atomically
    let purcherID;
    let attendeesWithIds = [];
    await session.withTransaction(async () => {
      const purcherDetails = {
        totalPrice,
        taxAmount,
        groupDiscount,
        couponDiscount,
        lowTicketsQuantity,
        fullTicketsQuantity,
        corporateTicketsQuantity,
        finalAmount: payAblePrice,
        transactionID: paymentResult.transaction.id,
        purcher: purcherAttendeesData.purcher,
        paymentStatus: "Completed",
        createdAt: new Date(),
      };

      const insertPurcher = await db
        .collection("ThriveGlobalForum-Tickets-Purcher")
        .insertOne(purcherDetails, { session });
      purcherID = insertPurcher.insertedId;

      // Enrich attendees with transaction info and purcherID
      const enrichedAttendees = purcherAttendeesData.attendees.map((att) => ({
        ...att,
        transactionID: paymentResult.transaction.id,
        purcherID,
        paymentStatus: "Completed",
        createdAt: new Date(),
      }));

      const insertAttendees = await db
        .collection("ThriveGlobalForum-Tickets-Attendees")
        .insertMany(enrichedAttendees, { session });

      attendeesWithIds = Object.values(insertAttendees.insertedIds).map(
        (id, idx) => ({
          _id: id,
          ...enrichedAttendees[idx],
        }),
      );

      await db
        .collection("ThriveGlobalForum-Tickets-Purcher")
        .updateOne(
          { _id: purcherID },
          { $set: { attendees: attendeesWithIds } },
          { session },
        );
    });

    // 4. Send confirmation email (non-blocking)
    const templatePath = path.join(__dirname, "views", "email-template.ejs");
    const htmlTemplate = fs.readFileSync(templatePath, "utf-8");
    const htmlContent = ejs.render(htmlTemplate, {
      transactionID: paymentResult.transaction.id,
      totalPrice,
      taxAmount,
      groupDiscount,
      couponDiscount,
      finalAmount: payAblePrice,
      lowTicketsQuantity,
      fullTicketsQuantity,
      corporateTicketsQuantity,
      totalTickets,
      attendees: attendeesWithIds,
      purcher: purcherAttendeesData.purcher,
      createdAt: localDate(new Date()),
    });

    transporter.sendMail(
      {
        from: `'Thrive Global Forum' ${process.env.NODE_MAILER_USER_EMAIL}`,
        to: `${purcherAttendeesData.purcher.email}`,
        subject:
          "International Conference on Entrepreneurship, Health and Climate",
        html: htmlContent,
      },
      (err, info) => {
        if (err) console.error("Email sending error:", err);
        else console.log("Email sent:", info.response);
      },
    );
    transporter.sendMail(
      {
        from: `'Thrive Global Forum' ${process.env.NODE_MAILER_USER_EMAIL}`,
        to: `registration@thriveglobalforum.com`,
        subject:
          "International Conference on Entrepreneurship, Health and Climate",
        html: htmlContent,
      },
      (err, info) => {
        if (err) console.error("Email sending error:", err);
        else console.log("Email sent:", info.response);
      },
    );

    for (const attendee of attendeesWithIds) {
      await sendEmailToAttendee(attendee);
    }

    // 5. Return success response
    res.status(200).json({
      success: true,
      transactionID: paymentResult.transaction.id,
      purcherID,
      finalAmount: payAblePrice,
    });
  } catch (error) {
    console.error("Payment processing error:", error);
    res
      .status(500)
      .json({ error: "Payment processing failed. Please try again." });
  } finally {
    await session.endSession();
  }
};
// ______________________________________________________________________
// ______________________________________________________________________

// Get Purcher DATA ______________________________________________________
// _______________________________________________________________________
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
        .collection("ThriveGlobalForum-Tickets-Purcher")
        .find(query)
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      db.collection("ThriveGlobalForum-Tickets-Purcher").countDocuments(query),
    ]);

    const totalPages = Math.ceil(filteredCount / limit);

    res.status(200).json({
      data,
      currentPage: page,
      perPage: limit,
      totalCount: filteredCount,
      totalPages,
      message: "ThriveGlobalForum Purcher DATA",
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
      .collection("ThriveGlobalForum-Tickets-Purcher")
      .findOne({ _id: new ObjectId(id) });
    res.send({
      status: 200,
      message: "ThriveGlobalForum purcher Details",
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

    const purcher = await db
      .collection("ThriveGlobalForum-Tickets-Purcher")
      .findOne({
        _id: new ObjectId(purcherID),
      });

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
      .collection("ThriveGlobalForum-Tickets-Purcher")
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
      .collection("ThriveGlobalForum-Tickets-Attendees")
      .findOne({
        _id: new ObjectId(attendeeId),
      });

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
        .collection("ThriveGlobalForum-Tickets-Attendees")
        .find(query) // ✅ use the query here
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      db
        .collection("ThriveGlobalForum-Tickets-Attendees")
        .countDocuments(query),
    ]);

    const totalPages = Math.ceil(filteredCount / limit);

    res.status(200).json({
      data,
      currentPage: page,
      perPage: limit,
      totalCount: filteredCount,
      totalPages,
      message: "ThriveGlobalForum Attendees DATA",
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
      .collection("ThriveGlobalForum-Tickets-Attendees")
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
