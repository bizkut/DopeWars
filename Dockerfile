# Use an official Node.js runtime as a parent image
FROM node:alpine

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install build dependencies for sqlite3 and other native modules on Alpine
RUN apk add --no-cache python3 make g++

# Install app dependencies
RUN npm install --include=dev

# Copy the rest of the application code
COPY . .

# Expose port 3000
EXPOSE 3000

# Command to run the application
CMD ["npm", "start"]
