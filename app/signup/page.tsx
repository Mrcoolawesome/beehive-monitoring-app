import SignupForm from "./SignupForm";

export default function SignupPage() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold text-[var(--foreground)]">
        Create an account
      </h1>
      <SignupForm />
      <p className="text-sm text-[var(--text-muted)]">
        Already have an account?{" "}
        <a href="/login" className="text-[var(--series-1)] hover:underline">
          Sign in
        </a>
      </p>
    </div>
  );
}
