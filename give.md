# ATS Project Guide

## Overview
This project is an internal talent acquisition system built with Next.js and Firebase. It supports the full hiring lifecycle from requisition creation and department approval to candidate management, interview coordination, offers, referrals, and reporting.

The app is designed for a single-team setup where hiring managers, department heads, recruiters, and admins all work from one shared URL.

## Product Flow
1. A hiring manager creates a requisition for a department.
2. The requisition enters a pending approval state.
3. Department heads review and approve or reject it.
4. Approved requisitions move into the operational hiring pipeline.
5. Admins manage candidates, interviews, schedules, feedback, and offer progression.

## Main Features
- Requisition creation and lifecycle tracking
- Department-based approval workflow
- Candidate intake and pipeline management
- Interview scheduling and calendar invites
- Offer joining workflows
- Referral and payout tracking
- Vendors spend tracking
- Talent pool search and candidate organization
- Department dashboards and analytics
- Public social job application support

## Tech Stack
- Next.js 15
- React 19
- TypeScript
- Firebase Authentication
- Firebase Admin SDK
- Firestore / Firebase backend integration
- Google Calendar API integration
- Tailwind CSS
- PDF / DOC parsing support via mammoth and pdf-parse
- XLSX for spreadsheet processing

## Project Structure
- `src/app/` - App router pages and API endpoints
- `src/components/ats/` - ATS dashboard and feature UI components
- `src/lib/` - auth, Firebase helpers, domain logic, utility modules
- `src/lib/db/` - database helpers and data access functions
- `scripts/` - developer and seed scripts
- `public/` - static assets

## Key Application Areas
### App Pages
The app router contains both public and authenticated flows:
- login flow
- admin and dashboard pages
- candidate pages
- requisition pages
- API routes for analytics, approvals, schedules, referrals, offers, and org data

### ATS Components
The ATS UI is organized into feature-focused panels such as:
- `RecruiterDashboard`
- `HiringManagerDashboard`
- `DepartmentHeadDashboard`
- `AnalyticsView`
- `ApprovalsView`
- `PipelinePanel`
- `OfferJoiningView`
- `TalentPoolView`
- `TeamView`
- `TodayView`

### Library Modules
The `src/lib` directory contains the core business logic, especially:
- authentication and access logic
- date and formatting utilities
- hiring/requisition status rules
- email and notification helpers
- interview planning and offer management
- Firebase admin setup and client configuration

## Environment Setup
Create your local environment file from `.env.example` and fill in the Firebase and Google settings.

Example required variables:
```bash
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
FIREBASE_ADMIN_CREDENTIALS_PATH=./your-firebase-adminsdk.json
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=
GOOGLE_CALENDAR_ENABLED=0
GOOGLE_CALENDAR_IMPERSONATE_EMAIL=
GOOGLE_CALENDAR_TIMEZONE=Asia/Kolkata
```

## Local Development
```bash
npm install
cp .env.example .env.local
npm run seed
npm run dev
```

Then open:
```text
http://localhost:3000
```

## Available Scripts
```bash
npm run dev
npm run build
npm start
npm run lint
npm run seed
npm run clean
```

## Deployment
This app is intended for Vercel deployment. The README notes the typical flow:
1. Push the project to GitHub
2. Import it into Vercel
3. Add the required environment variables
4. Deploy and share the generated URL with the team

## Notes
- Google Sign-In is the primary authentication method.
- Department assignment for hiring managers and department heads is important for the approval flow.
- Calendar integration is optional and controlled by `GOOGLE_CALENDAR_ENABLED`.
- The seed script helps initialize org/user data needed for local development.

## Summary
This repository is a full internal ATS platform focused on hiring operations, approvals, candidate pipeline management, and reporting. It is built around a Firebase-backed auth and data model with a Next.js frontend and role-based operational workflows.
