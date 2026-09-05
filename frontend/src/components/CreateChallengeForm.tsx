// "Create Challenge" form (Stage 7).
//
// Shown only when the user is logged in. Client-side validation mirrors the
// backend's zod rules so bad input (negative nimAmount, end before start,
// empty required fields) is caught BEFORE a network request — but the backend
// stays the source of truth: any error it returns is shown as-is, because
// client-side checks are never a substitute for server validation.

import { useState, type FormEvent } from "react";
import {
  createChallenge,
  type Challenge,
  type CreateChallengeData,
} from "../api";

interface CreateChallengeFormProps {
  token: string;
  // Called with the freshly-created challenge on success (App navigates to
  // its detail view).
  onCreated: (challenge: Challenge) => void;
}

// Current values of every field. Dates live in the <input type="datetime-local">
// string format ("YYYY-MM-DDTHH:mm") and are converted to ISO only on submit.
interface FormFields {
  title: string;
  description: string;
  rules: string;
  nimAmount: string; // kept as a string because <input> always yields text
  startDate: string;
  endDate: string;
  proofRequired: boolean;
}

// One optional message per field, shown inline under the input.
interface FieldErrors {
  title?: string;
  description?: string;
  rules?: string;
  nimAmount?: string;
  startDate?: string;
  endDate?: string;
}

const EMPTY_FIELDS: FormFields = {
  title: "",
  description: "",
  rules: "",
  nimAmount: "",
  startDate: "",
  endDate: "",
  proofRequired: true, // matches the backend model's default
};

// Mirrors the backend's validation (src/services/challenges.ts) so the user
// gets instant feedback instead of a round-trip to the server.
function validateForm(f: FormFields): FieldErrors {
  const errors: FieldErrors = {};

  if (f.title.trim() === "") errors.title = "Title is required.";
  if (f.description.trim() === "") errors.description = "Description is required.";
  if (f.rules.trim() === "") errors.rules = "Rules are required.";

  const amount = Number(f.nimAmount);
  if (f.nimAmount.trim() === "" || !Number.isFinite(amount) || amount <= 0) {
    errors.nimAmount = "nimAmount must be a positive number.";
  }

  const start = new Date(f.startDate);
  const end = new Date(f.endDate);
  if (f.startDate === "" || !Number.isFinite(start.getTime())) {
    errors.startDate = "Start date must be a valid date.";
  } else if (f.endDate === "" || !Number.isFinite(end.getTime())) {
    errors.endDate = "End date must be a valid date.";
  } else if (end <= start) {
    errors.endDate = "End date must be after the start date.";
  }

  return errors;
}

// Shared input styling so every field looks the same.
const inputClass =
  "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm " +
  "focus:border-zinc-900 focus:outline-none";

export function CreateChallengeForm({ token, onCreated }: CreateChallengeFormProps) {
  const [fields, setFields] = useState<FormFields>(EMPTY_FIELDS);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Update one-or-more fields and immediately clear the inline error for the
  // fields being edited, so errors never linger after the user fixes them.
  const update = (patch: Partial<FormFields>) => {
    setFields((prev) => ({ ...prev, ...patch }));
    const cleared: FieldErrors = {};
    for (const key of Object.keys(patch)) {
      (cleared as Record<string, undefined>)[key] = undefined;
    }
    setFieldErrors((prev) => ({ ...prev, ...cleared }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); // stop the browser from doing a native form submit

    // 1. Client-side validation — catch bad input before hitting the network.
    const errors = validateForm(fields);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    // 2. Convert the form into the API's expected payload.
    const payload: CreateChallengeData = {
      title: fields.title.trim(),
      description: fields.description.trim(),
      rules: fields.rules.trim(),
      nimAmount: Number(fields.nimAmount),
      startDate: new Date(fields.startDate).toISOString(),
      endDate: new Date(fields.endDate).toISOString(),
      proofRequired: fields.proofRequired,
    };

    // 3. POST to the backend.
    setSubmitting(true);
    setFormError(null);
    try {
      const { challenge } = await createChallenge(token, payload);
      // Success — clear the form and hand the challenge up to the app.
      setFields(EMPTY_FIELDS);
      setFieldErrors({});
      onCreated(challenge);
    } catch (err) {
      // The backend rejected us (validation, auth, ...) — surface its message.
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-lg bg-white p-4 shadow-sm"
    >
      <h2 className="font-semibold text-zinc-900">New challenge</h2>
      <p className="mt-1 text-xs text-zinc-400">
        Solo challenge for your own wallet. nimAmount is stored only — no NIM
        moves yet (that comes in a later stage).
      </p>

      <label className="mt-3 block">
        <span className="text-sm text-zinc-600">Title</span>
        <input
          type="text"
          value={fields.title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="e.g. Read 20 pages every day"
          className={inputClass}
        />
        {fieldErrors.title && (
          <span className="mt-1 block text-xs text-red-600">{fieldErrors.title}</span>
        )}
      </label>

      <label className="mt-3 block">
        <span className="text-sm text-zinc-600">Description</span>
        <textarea
          value={fields.description}
          onChange={(e) => update({ description: e.target.value })}
          rows={3}
          placeholder="What is this challenge about?"
          className={inputClass}
        />
        {fieldErrors.description && (
          <span className="mt-1 block text-xs text-red-600">{fieldErrors.description}</span>
        )}
      </label>

      <label className="mt-3 block">
        <span className="text-sm text-zinc-600">Rules</span>
        <textarea
          value={fields.rules}
          onChange={(e) => update({ rules: e.target.value })}
          rows={2}
          placeholder="e.g. Must be done daily before midnight, screenshot as proof"
          className={inputClass}
        />
        {fieldErrors.rules && (
          <span className="mt-1 block text-xs text-red-600">{fieldErrors.rules}</span>
        )}
      </label>

      <label className="mt-3 block">
        <span className="text-sm text-zinc-600">NIM amount</span>
        <input
          type="number"
          min="0"
          step="any"
          value={fields.nimAmount}
          onChange={(e) => update({ nimAmount: e.target.value })}
          placeholder="e.g. 10"
          className={inputClass}
        />
        {fieldErrors.nimAmount && (
          <span className="mt-1 block text-xs text-red-600">{fieldErrors.nimAmount}</span>
        )}
      </label>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm text-zinc-600">Starts at</span>
          <input
            type="datetime-local"
            value={fields.startDate}
            onChange={(e) => update({ startDate: e.target.value })}
            className={inputClass}
          />
          {fieldErrors.startDate && (
            <span className="mt-1 block text-xs text-red-600">{fieldErrors.startDate}</span>
          )}
        </label>

        <label className="block">
          <span className="text-sm text-zinc-600">Ends at</span>
          <input
            type="datetime-local"
            value={fields.endDate}
            onChange={(e) => update({ endDate: e.target.value })}
            className={inputClass}
          />
          {fieldErrors.endDate && (
            <span className="mt-1 block text-xs text-red-600">{fieldErrors.endDate}</span>
          )}
        </label>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-zinc-600">
        <input
          type="checkbox"
          checked={fields.proofRequired}
          onChange={(e) => update({ proofRequired: e.target.checked })}
          className="h-4 w-4"
        />
        Require proof of completion
      </label>

      {formError && (
        <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-4 w-full rounded-lg bg-zinc-900 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Creating&hellip;" : "Create Challenge"}
      </button>
    </form>
  );
}