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

// Function to calculate the confidence level
function calculateConfidence(prices) {
    console.log('Calculating the confidence level...');
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    console.log(`Last month: ${lastMonth.toISOString().split('T')[0]}`);

    // Filter prices within the last month
    const recentPrices = prices
        .filter((transaction) => new Date(transaction.date) <= lastMonth)
        .map((transaction) => parseFloat(transaction.price));
        console.log(recentPrices)

    if (recentPrices.length === 0) {
        return 'Low'; // Default to 'Low' if no recent prices are found
    }

    // Calculate the average price of recent transactions
    const averagePrice = recentPrices.reduce((acc, price) => acc + price, 0) / recentPrices.length;

    // Calculate the average deviation
    const averageDeviation = recentPrices.reduce((acc, price) => acc + Math.abs(price - averagePrice), 0) / recentPrices.length;

    // Determine confidence level based on the deviation
    if (averageDeviation < averagePrice * 0.1) {
        return 'High';
    } else if (averageDeviation < averagePrice * 0.2) {
        return 'Medium';
    } else {
        return 'Low';
    }
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
