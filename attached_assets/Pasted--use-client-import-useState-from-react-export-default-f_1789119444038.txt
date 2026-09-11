"use client";

import { useState } from "react";

export default function OnboardingPage() {
  const [placeId, setPlaceId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState("");

  const next = () => setStep(step + 1);

  const submitBasicInfo = async () => {
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId, name, email })
    });

    const data = await res.json();
    setStatus(data.message);
    next();
  };

  return (
    <div className="upgrade-container">
      {step === 1 && (
        <>
          <h1>Welcome to The Food Advisor</h1>
          <p>Let’s get your restaurant set up.</p>
          <button className="upgrade-button" onClick={next}>
            Start Onboarding
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <h2>Restaurant Verification</h2>
          <p>Enter your Google Place ID so we can verify your listing.</p>

          <input
            type="text"
            placeholder="ChIJN3S8..."
            value={placeId}
            onChange={(e) => setPlaceId(e.target.value)}
          />

          <button className="upgrade-button" onClick={next}>
            Continue
          </button>
        </>
      )}

      {step === 3 && (
        <>
          <h2>Basic Information</h2>
          <p>We’ll use this to personalise your listing.</p>

          <input
            type="text"
            placeholder="Restaurant Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <input
            type="email"
            placeholder="Contact Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <button className="upgrade-button" onClick={submitBasicInfo}>
            Save & Continue
          </button>

          {status && <p>{status}</p>}
        </>
      )}

      {step === 4 && (
        <>
          <h2>Upload Your Menu</h2>
          <p>You can upload your menu now or skip this step.</p>

          <button
            className="upgrade-button"
            onClick={() => (window.location.href = "/menu-upload")}
          >
            Upload Menu
          </button>

          <button className="upgrade-button" onClick={next}>
            Skip for Now
          </button>
        </>
      )}

      {step === 5 && (
        <>
          <h2>Your Premium Preview</h2>
          <p>See what your upgraded listing will look like.</p>

          <button
            className="upgrade-button"
            onClick={() => (window.location.href = "/upgrade/preview")}
          >
            View Premium Preview
          </button>
        </>
      )}
    </div>
  );
}
