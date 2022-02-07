const { version: SERVER_VERSION } = require('../package.json');
process.env.SERVER_VERSION = SERVER_VERSION;

// TODO: UPGRADE TO TYPESCRIPT

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../.env') });

const fs = require('fs');

const init = require('./schema');

const log = require('./lib/logger');
log.initLogger();
const express = require('express');
// const device = require('express-device');

const SKU = require('@tf2autobot/tf2-sku');
const generateBptfUrl = require('../utils/generateBptfUrl');
const getImage = require('../utils/getImage');
const getQualityColor = require('../utils/getQualityColor');
const testSKU = require('../utils/validateSKU');

log.default.debug('Initializing tf2schema...');
init().then((schemaManager) => {
    const schemaPath = path.join(__dirname, '../public/files/schema.json');

    let defindexes = getDefindexes(schemaManager.schema);
    generateSchemaFile(schemaManager.schema, schemaPath);

    const hours12 = 12 * 60 * 60 * 1000;
    const mins2 = 2 * 60 * 1000;
    setInterval(() => {
        generateSchemaFile(schemaManager.schema, schemaPath);

        defindexes = getDefindexes(schemaManager.schema);
    }, hours12 + mins2);

    const app = express();
    // const router = express.Router();

    const port = process.env.PORT;

    // .set('views', path.join(__dirname, '../views/'))
    app.use(express.static(path.join(__dirname, '../public'))).set(
        'view engine',
        'ejs'
    );
    // app.use(device.capture());

    // TODO: Error handling/landing page
    // TODO: Refactor - use router, etc...
    // TODO: Implement rate limiter with (should be done elsewhere)

    app.get('/', (req, res) => {
        log.default.info(`Got GET / request (main page)`);
        res.sendFile(path.join(__dirname, '../views/index.html'));
    });
    app.get('/download/schema', (req, res) => {
        log.default.info(`Got GET /download/schema request`);
        res.download(schemaPath);
    });
    app.get('/json/schema', (req, res) => {
        log.default.info(`Got GET /json/schema request`);
        res.json(schemaManager.schema);
    });
    app.get('/items/:sku', async (req, res) => {
        const protocol =
            req.headers['x-forwarded-proto'] === undefined
                ? 'http'
                : req.headers['x-forwarded-proto'];
        const host = req.headers.host;
        const domain = `${protocol}://${host}`;

        const sku = req.params.sku;
        const item = SKU.fromString(sku);
        const isExist = schemaManager.schema.checkExistence(item);

        // const deviceType = req.device.type.toLowerCase();
        // const isPhone = deviceType === 'phone';

        if (
            testSKU(sku) &&
            defindexes[item.defindex] !== undefined &&
            isExist !== null
        ) {
            log.default.info(`Got GET /items/${sku} request`);

            const itemName = schemaManager.schema.getName(item, true);
            const baseItemData = schemaManager.schema.getItemBySKU(sku);
            const image = await getImage(
                schemaManager.schema,
                item,
                itemName,
                baseItemData,
                domain
            );

            res.render('items/index', {
                sku: sku.replace(/;[p][0-9]+/g, ''), // Ignore painted attribute
                name: itemName,
                quality: getQualityColor(item.quality),
                image,
                description: baseItemData?.item_description,
                bptfUrl: generateBptfUrl(schemaManager.schema, item),
            });
        } else {
            log.default.warn(`Failed on GET /items/${sku} request`);
            if (defindexes[item.defindex] === undefined || isExist === null) {
                res.json({
                    success: false,
                    message: `Item does not exist. Please try again. Your can download tf2 schema here: ${domain}/download/schema`,
                });
            } else {
                res.json({
                    success: false,
                    message: 'Invalid sku format. Please try again.',
                });
            }
        }
    });

    app.listen(port, () => {
        log.default.info(`Server is now live at http://localhost:${port}`);
    });
});

function generateSchemaFile(schema, schemaPath) {
    fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2), {
        encoding: 'utf8',
    });
}

function getDefindexes(schema) {
    const schemaItems = schema.raw.schema.items;
    const schemaItemsSize = schemaItems.length;
    const defindexes = {};

    for (i = 0; i < schemaItemsSize; i++) {
        const schemaItem = schemaItems[i];
        defindexes[schemaItem.defindex] = schemaItem.item_name;
    }

    return defindexes;
}

const ON_DEATH = require('death');
const inspect = require('util');

ON_DEATH({ uncaughtException: true })((signalOrErr, origin) => {
    const crashed = signalOrErr !== 'SIGINT';

    if (crashed) {
        log.default.error(
            [
                'Server' +
                    ' crashed! Please create an issue with the following log:',
                `package.version: ${
                    process.env.SERVER_VERSION || undefined
                }; node: ${process.version} ${process.platform} ${
                    process.arch
                }}`,
                'Stack trace:',
                inspect.inspect(origin),
            ].join('\r\n')
        );
    } else {
        log.default.warn('Received kill signal `' + signalOrErr + '`');
    }

    log.default.info('Server uptime:' + process.uptime());
    process.exit(1);
});
