const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const { promisify } = require('util');

const PROTO_PATH = path.join(__dirname, '../shared/domus.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});
const domusProto = grpc.loadPackageDefinition(packageDefinition).domus;

const client = new domusProto.DomusService(
    process.env.DOMUS_GRPC_URL || 'localhost:50051',
    grpc.credentials.createInsecure(),
);

// Promisify pour pouvoir utiliser async/await au lieu de callbacks
const verifyUser = promisify(client.VerifyUser.bind(client));

module.exports = { verifyUser };
