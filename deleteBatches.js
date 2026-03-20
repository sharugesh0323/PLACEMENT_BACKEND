const mongoose = require('mongoose');
require('dotenv').config();

const Batch = require('./src/models/Batch');
const User = require('./src/models/User');

const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/jjcet-tp';

mongoose.connect(uri)
    .then(async () => {
        console.log('Connected to DB');

        // Delete all batches EXCEPT "BATCH 1"
        const delResult = await Batch.deleteMany({ name: { $ne: 'BATCH 1' } });
        console.log(`Deleted ${delResult.deletedCount} bad batches.`);

        // Also clean the students' records so they don't say BATCH 2 or BATCH I
        const userResult = await User.updateMany(
            { trainingBatch: { $in: ['BATCH 2', 'BATCH I', 'batch 2', 'Batch 2'] } },
            { $set: { trainingBatch: '' } }
        );
        console.log(`Cleaned ${userResult.modifiedCount} users with bad training batches.`);

        process.exit(0);
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
