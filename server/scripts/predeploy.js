import dotenv from 'dotenv';

dotenv.config();

console.log(`AWS_PROFILE=${process.env.AWS_USERNAME}`);
