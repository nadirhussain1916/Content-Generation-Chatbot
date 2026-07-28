import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function TermsPage() {
  return (
    <div className='min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-200 transition-colors'>
      {/* Ambient glow */}
      <div className='pointer-events-none fixed inset-0 z-0 overflow-hidden'>
        <div className='absolute -top-40 right-0 w-[600px] h-[600px] bg-violet-500/5 dark:bg-violet-600/5 rounded-full blur-3xl' />
        <div className='absolute bottom-0 left-1/4 w-96 h-96 bg-violet-500/5 dark:bg-violet-800/5 rounded-full blur-3xl' />
      </div>

      <div className='relative z-10 max-w-3xl mx-auto px-6 py-12'>
        {/* Back nav */}
        <Link
          to='/'
          className='inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors mb-10'
        >
          <ArrowLeft size={14} />
          Back to home
        </Link>

        <h1 className='text-3xl font-bold text-gray-900 dark:text-white mb-2'>Terms of Service</h1>
        <p className='text-sm text-gray-400 dark:text-gray-500 mb-10'>Last updated: July 25, 2026</p>

        <Section title='1. Acceptance of Terms'>
          By accessing or using CreatorOS ("the Service"), you agree to be bound by these Terms of
          Service. If you do not agree, do not use the Service.
        </Section>

        <Section title='2. Description of Service'>
          CreatorOS is an AI-powered content creation platform that helps creators generate, manage,
          and publish content to social media platforms including Instagram and TikTok. The Service
          uses third-party AI models to generate images, videos, and written content based on your
          inputs.
        </Section>

        <Section title='3. User Accounts'>
          You must create an account to use the Service. You are responsible for maintaining the
          confidentiality of your account credentials and for all activity that occurs under your
          account. You must provide accurate information and keep it up to date.
        </Section>

        <Section title='4. Connected Social Accounts'>
          The Service allows you to connect your Instagram and TikTok accounts via OAuth. By
          connecting these accounts, you grant CreatorOS permission to publish content on your
          behalf. You may disconnect your social accounts at any time from the Settings page. We
          store only the access tokens necessary to perform publishing actions.
        </Section>

        <Section title='5. Content and AI Generation'>
          You are solely responsible for the content you publish through the Service, including
          AI-generated content. You must ensure that all published content complies with the terms
          and community guidelines of the respective social media platforms (Instagram, TikTok) and
          all applicable laws. CreatorOS does not review content before it is published.
        </Section>

        <Section title='6. Acceptable Use'>
          You agree not to use the Service to:
          <ul className='list-disc list-inside mt-2 space-y-1'>
            <li>Publish content that violates any applicable law or regulation</li>
            <li>Infringe on intellectual property rights of others</li>
            <li>Harass, abuse, or harm other individuals</li>
            <li>Distribute spam or unsolicited content</li>
            <li>Attempt to gain unauthorized access to the Service or its systems</li>
            <li>Violate TikTok&apos;s or Instagram&apos;s terms of service or content policies</li>
          </ul>
        </Section>

        <Section title='7. Intellectual Property'>
          You retain ownership of all content you create and publish through the Service.
          AI-generated content produced by the Service based on your prompts is provided to you for
          use subject to these terms. CreatorOS retains all rights to the Service itself, including
          its software, design, and branding.
        </Section>

        <Section title='8. Third-Party Services'>
          The Service integrates with third-party platforms and APIs including OpenAI, Replicate,
          Clerk, Instagram, and TikTok. Your use of those platforms is governed by their respective
          terms of service. CreatorOS is not responsible for the availability or behavior of
          third-party services.
        </Section>

        <Section title='9. Disclaimers'>
          The Service is provided "as is" without warranties of any kind. We do not guarantee that
          the Service will be uninterrupted, error-free, or that AI-generated content will meet your
          expectations. We are not liable for any content published to social media platforms through
          the Service.
        </Section>

        <Section title='10. Limitation of Liability'>
          To the maximum extent permitted by law, CreatorOS shall not be liable for any indirect,
          incidental, special, consequential, or punitive damages arising from your use of the
          Service.
        </Section>

        <Section title='11. Changes to Terms'>
          We may update these Terms at any time. Continued use of the Service after changes
          constitutes acceptance of the updated Terms. We will make reasonable efforts to notify
          users of significant changes.
        </Section>

        <Section title='12. Contact'>
          For questions about these Terms, contact us at the email address associated with your
          account or through the support channels provided in the Service.
        </Section>

        {/* Footer links */}
        <div className='mt-12 pt-8 border-t border-gray-200 dark:border-gray-800 flex gap-6 text-xs text-gray-400 dark:text-gray-500'>
          <Link to='/privacy' className='hover:text-violet-600 dark:hover:text-violet-400 transition-colors'>Privacy Policy</Link>
          <Link to='/' className='hover:text-violet-600 dark:hover:text-violet-400 transition-colors'>Home</Link>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className='mb-8'>
      <h2 className='text-base font-semibold text-gray-900 dark:text-white mb-3'>{title}</h2>
      <div className='text-gray-500 dark:text-gray-400 leading-relaxed text-sm'>{children}</div>
    </div>
  );
}
