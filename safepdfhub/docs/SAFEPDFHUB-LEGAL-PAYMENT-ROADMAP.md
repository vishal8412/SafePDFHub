# SafePDFHub — Legal & Payment Roadmap for an Indian Salaried Individual

**Context:** Indian resident, currently salaried at an MNC, current package about ₹17 LPA, no GST registration yet, building SafePDFHub as a side business.

> This is a practical product/business roadmap, not legal or tax advice. Before taking live commercial payments, have an Indian CA/tax professional review the exact SafePDFHub business model, customer geography, payment flow, employment agreement and GST position.

## Recommended ownership

**Preferred:** operate SafePDFHub in the developer/founder's own name through a sole-proprietorship structure when commercial activity begins.

Do not put the business in a spouse's name merely to reduce tax or bypass an employer's moonlighting/side-business policy. If the wife genuinely owns and operates the business, then the ownership, contracts, bank account, payment gateway, IP and tax reporting should consistently reflect that reality.

## Suggested sequence

1. Review MNC employment agreement/policies for moonlighting, outside business, conflict of interest and IP.
2. Keep SafePDFHub completely separate from employer equipment, accounts, code and working time.
3. Choose a trade name and operate as a sole proprietorship rather than forming a Pvt Ltd/LLP immediately.
4. Open a dedicated bank/current account for SafePDFHub when payment activity starts.
5. Obtain Udyam/MSME registration if useful for business proof and banking/gateway onboarding.
6. Obtain IEC when required by the payment gateway, when taking Foreign Trade Policy benefits, or when otherwise appropriate for the export setup. DGFT states that IEC is not necessary for service exports except when the service provider is taking benefits under the Foreign Trade Policy; payment providers can impose additional requirements.
7. For paid SaaS/export services, have a CA confirm the GST registration position before launch. If registering, use GST + LUT for qualifying exports so invoices can be raised as zero-rated exports without charging IGST, subject to the applicable rules.
8. Apply for a payment gateway. PayU is the first provider to investigate for this project; Razorpay is the secondary option. Stripe is not the first choice because India accounts are invite-only and individuals cannot accept international payments through Stripe India.
9. Maintain invoices, gateway settlement reports, bank credits, refunds, chargebacks, fees and foreign-exchange records.
10. File the appropriate income-tax return with salary + SafePDFHub business income. A CA should decide whether ITR-3 or an eligible presumptive route such as ITR-4 applies.

## GST position

Salary is not SafePDFHub business turnover. The GST analysis should be based on the supplies made by the business.

Exports of qualifying services are zero-rated. GST registration/LUT should be planned with a CA if SafePDFHub is selling SaaS/services to overseas customers and wants the normal export/LUT workflow or input-tax-credit/refund benefits.

Do not assume that the ₹20 lakh service-provider threshold automatically makes every cross-border SaaS situation exempt from registration. Export, zero-rating, refund/LUT and payment-gateway requirements need to be considered together.

## IEC position

For service exports, DGFT's current IEC manual says IEC is generally not necessary except when the service provider is taking benefits under the Foreign Trade Policy. However, payment gateways may still require IEC for their international-payment onboarding or for specific card/payment methods.

For SafePDFHub, obtaining IEC once the business is formalized is a sensible practical step if international payments are a core part of the plan.

## Payment flow

Customer in USA/EU/UK/etc.
→ SafePDFHub checkout
→ payment gateway processes card/payment method
→ cross-border transaction is reported through the gateway/banking rails
→ gateway settles the merchant in India according to the approved settlement configuration
→ maintain invoice + settlement/foreign-exchange evidence
→ report business income in India.

PayU's international-payment documentation says it supports international payments in 135+ currencies and its DCC documentation describes settlement to the merchant in INR. The exact currencies, presentment mode, KYC documents and settlement schedule are subject to PayU approval and configuration.

## Income tax

SafePDFHub profit is not a separate tax payer when operated as an individual/sole proprietorship. Business profit is added to the individual's taxable income alongside salary and other income.

For the current tax regime, the Income Tax Department publishes the following slabs for AY 2026-27/new-regime guidance: 0–₹4L nil, ₹4–8L 5%, ₹8–12L 10%, ₹12–16L 15%, ₹16–20L 20%, ₹20–24L 25%, above ₹24L 30%, plus applicable cess/surcharge rules.

Because the user's ₹17 LPA figure is CTC rather than final taxable income, exact tax cannot be calculated from CTC alone.

## Revenue checkpoints

### Around ₹1 lakh/year
- Stay with sole-proprietor/individual structure.
- Do not form a Pvt Ltd just for this revenue level.
- Keep separate business records and payment/bank evidence.
- Confirm the gateway can legally onboard the chosen business structure.
- Ask a CA to confirm whether GST registration is needed for the exact support/subscription model before live payments.

### Around ₹5 lakh/year
- Keep a dedicated business bank account.
- Formalize invoices and bookkeeping.
- Obtain Udyam/IEC if useful for onboarding/export documentation.
- Review GST/LUT status before international SaaS payments become material.
- Start tracking gateway fees, refunds and FX separately.

### Around ₹10 lakh/year
- Continue sole proprietorship unless there is a business/legal reason to change structure.
- Use a CA for annual return/tax planning.
- Review GST returns/LUT/export documentation if registered.
- Review employment conflict/IP position again if the side business is becoming substantial.
- Consider professional contracts, Terms, Privacy Policy and refund/cancellation rules appropriate to the paid product.

### Around ₹20 lakh/year
- Treat this as a major compliance checkpoint.
- Do not wait until the threshold to ask a CA about GST; the exact export/service model matters.
- Ensure GST registration/returns/LUT/export invoicing are correctly configured if applicable.
- Review whether sole proprietorship remains appropriate for liability, banking and growth.
- Consider LLP/Pvt Ltd only if there is a real business reason: investors, co-founders, liability, enterprise contracts, hiring, or scale—not simply because revenue crossed an arbitrary number.

## Wife vs own name

Recommended for this project: **your own name**.

Reason: you are the person building and controlling SafePDFHub. Putting the business in your wife's name only to reduce tax or to make it appear separate from your employment can create ownership, tax, IP and employment-policy problems.

A wife-owned business can be legitimate when she is genuinely the proprietor and the commercial/IP/financial arrangements reflect that. It should not be treated as a paper arrangement.
