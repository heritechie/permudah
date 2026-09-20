import { EarlyAccessForm } from "@/components/early-access-form";
import { Header } from "@/components/header";
import { WorkflowSteps } from "@/components/workflow-steps";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />

      <main className="flex flex-1 flex-col items-center px-6 text-center">
        <section
          id="early-access"
          className="mx-auto flex w-full max-w-3xl scroll-mt-10 flex-col items-center pt-20 sm:pt-28"
        >
          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-6xl">
            Ubah workflow-mu menjadi produk AI.
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-lg leading-8 text-zinc-600 sm:text-xl sm:leading-9">
            Jadikan keahlian, SOP, dan workflow-mu sebagai produk AI yang bisa
            dijual dan digunakan langsung di ChatGPT.
          </p>

          <div className="mt-10 flex w-full flex-col items-center gap-3">
            <EarlyAccessForm />
            <p className="mt-2 text-sm text-zinc-500">
              Be the first to know when Permudah is ready.
            </p>
          </div>
        </section>

        <section className="mx-auto w-full max-w-3xl pb-24 pt-24 sm:pt-28">
          <WorkflowSteps />
        </section>
      </main>
    </div>
  );
}