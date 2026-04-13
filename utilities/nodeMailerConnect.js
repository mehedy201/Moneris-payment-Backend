const nodemailer = require("nodemailer");

// module.exports.transporter = nodemailer.createTransport({
//     // host: "smtp.hostinger.com",
//     service: 'gmail',
//     port: 587,
//     secure: false, // Use `true` for port 465, `false` for all other ports if false 587 port
//     auth: {
//       user: process.env.NODE_MAILER_USER_EMAIL,// hostinger email
//       pass: process.env.NODE_MAILER_PASSWORD, // hostinger Email password
//     },
// });

module.exports.transporter = nodemailer.createTransport({
    host: "smtp.hostinger.com",
    // service: 'gmail',
    port: 465,
    secure: true, // Use `true` for port 465, `false` for all other ports if false 587 port
    auth: {
      user: process.env.NODE_MAILER_USER_EMAIL,// hostinger email
      pass: process.env.NODE_MAILER_PASSWORD, // hostinger Email password
    },
});