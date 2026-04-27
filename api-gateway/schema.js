const typeDefs = `#graphql
  type User {
    id: ID!
    name: String!
    email: String!
    role: String!
    coloc_id: ID
  }

  type Coloc {
    id: ID!
    name: String!
    invite_code: String!
  }

  type ColocWithToken {
    coloc: Coloc!
    token: String!
  }

  type Task {
    id: ID!
    title: String!
    status: String!
    assignee_id: ID!
    coloc_id: ID!
    created_at: String
  }

  type Dashboard {
    users: [User]
    tasks: [Task]
  }

  type Query {
    usersByColoc(colocId: ID!): [User]
    tasksByColoc(colocId: ID!): [Task]
    getColocDashboard(colocId: ID!): Dashboard
  }

  type Mutation {
    createColoc(name: String!): ColocWithToken
    joinColoc(invite_code: String!): ColocWithToken
    createTask(title: String!, assignee_id: ID!, coloc_id: ID!): Task
    updateTaskStatus(id: ID!, status: String!): Task
  }
`;

module.exports = typeDefs;
