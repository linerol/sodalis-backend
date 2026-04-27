const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const pool = require('./db');

const PROTO_PATH = path.join(__dirname, '../shared/domus.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});
const domusProto = grpc.loadPackageDefinition(packageDefinition).domus;

async function verifyUser(call, callback) {
    const { user_id, coloc_id } = call.request;
    try {
        const { rowCount } = await pool.query(
            'SELECT 1 FROM users WHERE id = $1 AND coloc_id = $2',
            [user_id, coloc_id],
        );

        callback(null, {
            is_valid: rowCount > 0,
            message: rowCount > 0
                ? 'Utilisateur validé'
                : "L'utilisateur n'appartient pas à cette colocation",
        });
    } catch (err) {
        callback(err);
    }
}

function startGrpcServer() {
    const server = new grpc.Server();
    server.addService(domusProto.DomusService.service, { VerifyUser: verifyUser });

    const GRPC_PORT = process.env.GRPC_PORT || 50051;
    server.bindAsync(`0.0.0.0:${GRPC_PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
        if (err) {
            console.error('❌ Erreur gRPC:', err);
            return;
        }
        console.log(`📡 Serveur gRPC Domus → port ${port}`);
    });
}

module.exports = startGrpcServer;