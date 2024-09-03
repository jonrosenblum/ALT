import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = 3000;

const BEARER_TOKEN = process.env.BEARER_TOKEN;
const API_URL_CERT = process.env.API_URL_CERT;
const API_URL_TRANSACTIONS = process.env.API_URL_TRANSACTIONS;

// Function to calculate the confidence level
function calculateConfidence(prices) {
    console.log('Calculating the confidence level...');

    // Helper function to filter prices by timespan
    const filterPrices = (days) => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        return prices
            .filter((transaction) => new Date(transaction.date) >= startDate)
            .map((transaction) => ({
                price: parseFloat(transaction.price),
                date: transaction.date,
            }));
    };

    // Helper function to calculate average price and deviation
    const calculateAverageAndDeviation = (recentPrices) => {
        if (recentPrices.length === 0) {
            return { averagePrice: 0, averageDeviation: 0, confidenceLevel: 'Low' };
        }

        const averagePrice = recentPrices.reduce((acc, transaction) => acc + transaction.price, 0) / recentPrices.length;
        const averageDeviation = recentPrices.reduce((acc, transaction) => acc + Math.abs(transaction.price - averagePrice), 0) / recentPrices.length;

        let confidenceLevel = 'Low';
        if (averageDeviation < averagePrice * 0.1) {
            confidenceLevel = 'High';
        } else if (averageDeviation < averagePrice * 0.2) {
            confidenceLevel = 'Medium';
        }

        return { averagePrice, averageDeviation, confidenceLevel };
    };

    // Timespans in days
    const timespans = {
        year: 365,
        quarter: 90,
        month: 30,
        week: 7,
    };

    // Calculate and log data for each timespan
    const results = {};
    for (const [period, days] of Object.entries(timespans)) {
        const recentPrices = filterPrices(days);
        const { averagePrice, averageDeviation, confidenceLevel } = calculateAverageAndDeviation(recentPrices);
        results[period] = {
            recentPrices,
            averagePrice,
            averageDeviation,
            confidenceLevel,
        };

        console.log(`${period.charAt(0).toUpperCase() + period.slice(1)} data:`);
        console.log('Recent prices:', recentPrices);
        console.log('Average price:', averagePrice);
        console.log('Average deviation:', averageDeviation);
        console.log('Confidence level:', confidenceLevel);
    }

    return results;
}

// Fetches the internal ID for a given slab number
async function getInternalId(slabNumber) {
    const response = await fetch(API_URL_CERT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${BEARER_TOKEN}`,
        },
        body: JSON.stringify({
            operationName: "Cert",
            variables: { certNumber: slabNumber },
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
    console.log('Internal ID:', data.data.cert.asset.id);
    console.log(data.data.cert.asset.name);
    return data.data.cert.asset.id;
}

// Fetches the market prices for a given internal ID
async function getPrices(internalId, gradingCompany, gradeNumber) {
    const gradingCompanies = gradingCompany ? [gradingCompany] : ["PSA", "BGS"];
    const gradeNumbers = {
        PSA: gradeNumber ? [gradeNumber] : ["9.0", "10.0"],
        BGS: gradeNumber ? [gradeNumber] : ["9.0", "9.5", "10.0"]
    };

    let allTransactions = [];

    // Loop through each grading company and its respective grade numbers
    for (const company of gradingCompanies) {
        for (const grade of gradeNumbers[company]) {
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
                            gradingCompany: company,
                            gradeNumber: grade,
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

            const transactions = data.data.asset.marketTransactions.map((m) => ({
                price: m.price,
                date: m.date,
                gradingCompany: company,
                gradeNumber: grade
            }));

            allTransactions = allTransactions.concat(transactions);

            // Break early if we have results and gradingCompany & gradeNumber were specified
            if (allTransactions.length > 0 && gradingCompany && gradeNumber) {
                break;
            }
        }
    }

    return allTransactions;
}

// API endpoint for fetching market prices and confidence level based on a slab number
app.get('/get-prices', async (req, res) => {
    const { slabNumber, gradingCompany, gradeNumber } = req.query;

    if (!slabNumber) {
        return res.status(400).send('Please provide a slab number');
    }

    try {
        const internalId = await getInternalId(slabNumber);
        let prices = await getPrices(internalId, gradingCompany, gradeNumber);

        // If no results found, fallback to fetching all grading companies and grades
        if (prices.length === 0) {
            prices = await getPrices(internalId);
        }

        const confidence = calculateConfidence(prices);

        res.json({
            prices: prices,
            confidence: confidence
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching data');
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
