const express = require('express');
const ThriveGlobalForum = require('../../../controlar/v1/ThriveGlobalForum/makePayment.controlar');
const router = express.Router();

// Get Braintree Client Token____________________________________
router.get('/client-token', ThriveGlobalForum.getBraintreeToken);
router.post('/checkout', ThriveGlobalForum.getThriveGlobalForumpaymentsFromEventTickets);

// Purcher API Route____________________________________
router.get('/purcher-data', ThriveGlobalForum.getPurcherData);
router.get('/purcher/:id', ThriveGlobalForum.getSinglePurcherDetails);
router.get('/download-single-purcher-details/:id', ThriveGlobalForum.downloadPurcherDetails);
router.get('/download-Full-purcher-Excel', ThriveGlobalForum.downloadFullPurcherExcel);

// Attendees API Route__________________________________
router.get('/attendees-data', ThriveGlobalForum.getAttendeesData);
router.get('/download-attendees-tickets/:id', ThriveGlobalForum.downloadAttendeesTickets);
router.get('/download-Full-Attendees-Excel', ThriveGlobalForum.downloadFullAttendeesExcel);


module.exports = router;