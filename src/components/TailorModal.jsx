import ClaudeHandoff from "./ClaudeHandoff.jsx";

/**
 * Tailoring handoff. With no job it kicks off the top-50 batch, which is the
 * main flow: score the jobs, then tailor the best 50.
 */
export default function TailorModal({ job, profile, onClose }) {
  const command = job
    ? `tailor — profile ${profile.id}, job ${job.id} (${job.title} at ${job.company})`
    : `tailor — profile ${profile.id}, top 50`;

  return (
    <ClaudeHandoff
      title="Tailor with Claude"
      blurb={
        job
          ? `Claude will build a tailored CV and cover letter for ${job.title} at ${job.company}.`
          : "Claude will tailor your top 50 scored jobs, best first."
      }
      command={command}
      steps={[
        <>Open Claude Code in this workspace (<code className="text-mist-dim">Desktop\claude</code>).</>,
        <>Paste the command below and send it.</>,
        <>Claude picks your best bullets, writes the CV + cover letter as PDFs, and moves each job to <span className="text-mist-bright">Tracker → Tailored</span>.</>,
      ]}
      onClose={onClose}
    />
  );
}
