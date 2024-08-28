import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const app = express();
const port = 3000;

// Use environment variables
const BEARER_TOKEN = process.env.BEARER_TOKEN;
const API_URL_CERT = process.env.API_URL_CERT;
const API_URL_TRANSACTIONS = process.env.API_URL_TRANSACTIONS;

/**
 * Fetches the internal ID for a given PSA number.
 *
 * @param {string} psaNumber - The PSA number for which to fetch the internal ID.
 * @returns {Promise<string>} - A promise that resolves to the internal ID.
 * @throws {Error} - Throws an error if the fetch request fails or if the response is invalid.
 */
async function getInternalId(psaNumber) {
    const response = await fetch(API_URL_CERT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${BEARER_TOKEN}`,
        },
        body: JSON.stringify({
            operationName: "Cert",
            variables: { certNumber: psaNumber },
            query: `query Cert($certNumber: String!) {
                cert(certNumber: $certNumber) {
                    ...CertBase
                    __typename
                }
            }
            fragment CertBase on Cert {
                certNumber
                asset {
                    id
                    name
                    __typename
                }
                __typename
            }`
        })
    });
    const data = await response.json();
    return data.data.cert.asset.id;
}

/**
 * Fetches the market prices for a given internal ID.
 *
 * @param {string} internalId - The internal ID for which to fetch the market prices.
 * @returns {Promise<Array<{price: number, date: string}>>} - A promise that resolves to an array of market transactions with prices and dates.
 * @throws {Error} - Throws an error if the fetch request fails or if the response is invalid.
 */
async function getPrices(internalId) {
    const response = await fetch(API_URL_TRANSACTIONS, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${BEARER_TOKEN}`,
        },
        body: JSON.stringify({
            operationName: "AssetMarketTransactions",
            variables: {
                id: internalId,
                marketTransactionFilter: {
                    gradingCompany: "PSA",
                    gradeNumber: "10.0",
                    showSkipped: true
                }
            },
            query: `query AssetMarketTransactions($id: ID!, $marketTransactionFilter: MarketTransactionFilter!) {
                asset(id: $id) {
                    marketTransactions(marketTransactionFilter: $marketTransactionFilter) {
                        price
                        date
                        __typename
                    }
                    __typename
                }
            }`
        })
    });
    const data = await response.json();
    return data.data.asset.marketTransactions.map((m) => ({
        price: m.price,
        date: m.date
    }));
}

/**
 * API endpoint for fetching market prices based on a PSA number.
 *
 * @param {string} [req.query.psaNumber] - The PSA number provided as a query parameter.
 * @returns {void}
 */
app.get('/get-prices', async (req, res) => {
    const psaNumber = req.query.psaNumber;

    if (!psaNumber) {
        return res.status(400).send('Please provide a PSA number');
    }

    try {
        const internalId = await getInternalId(psaNumber);
        const prices = await getPrices(internalId);
        res.json(prices);
    } catch (error) {
        res.status(500).send('Error fetching data');
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
