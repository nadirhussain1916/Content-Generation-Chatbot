export default function PrivacyPage() {
  return (
    <div className='min-h-screen bg-gray-950 text-gray-200'>
      <div className='max-w-3xl mx-auto px-6 py-16'>
        <h1 className='text-3xl font-bold text-white mb-2'>Privacy Policy</h1>
        <p className='text-sm text-gray-500 mb-10'>Last updated: July 25, 2026</p>

        <Section title='1. Introduction'>
          CreatorOS ("we", "our", or "us") is committed to protecting your privacy. This Privacy
          Policy explains how we collect, use, and protect your information when you use our Service.
        </Section>

        <Section title='2. Information We Collect'>
          <strong className='text-gray-300'>Account information:</strong> When you sign up, we
          collect your email address and profile information through Clerk, our authentication
          provider.
          <br /><br />
          <strong className='text-gray-300'>Workspace data:</strong> Content you create, including
          prompts, captions, scripts, brand settings, and generated assets stored in your workspace.
          <br /><br />
          <strong className='text-gray-300'>Social account tokens:</strong> When you connect
          Instagram or TikTok, we store OAuth access tokens to enable publishing on your behalf.
          These tokens are encrypted and never shared with third parties.
          <br /><br />
          <strong className='text-gray-300'>Usage data:</strong> Basic usage logs and error
          information to monitor and improve the Service.
        </Section>

        <Section title='3. How We Use Your Information'>
          <ul className='list-disc list-inside space-y-1 text-gray-400'>
            <li>To provide and operate the Service</li>
            <li>To generate AI content based on your prompts and workspace settings</li>
            <li>To publish content to connected social media accounts on your instruction</li>
            <li>To authenticate you and maintain your account security</li>
            <li>To monitor and improve Service performance and reliability</li>
            <li>To respond to support requests</li>
          </ul>
        </Section>

        <Section title='4. Social Media Integrations'>
          When you connect Instagram or TikTok:
          <ul className='list-disc list-inside mt-2 space-y-1 text-gray-400'>
            <li>We request only the permissions required for content publishing</li>
            <li>We store access tokens securely in our database</li>
            <li>We never post content without your explicit action</li>
            <li>You can disconnect your accounts at any time from Settings</li>
            <li>Disconnecting revokes our access and deletes stored tokens</li>
          </ul>
          <br />
          Your use of Instagram and TikTok is also subject to their respective privacy policies:
          Meta Privacy Policy and TikTok Privacy Policy.
        </Section>

        <Section title='5. AI-Generated Content'>
          Your prompts and workspace context are sent to third-party AI providers (OpenAI, Replicate)
          to generate content. Please review their privacy policies regarding how they handle input
          data. We do not sell your prompts or generated content to any party.
        </Section>

        <Section title='6. Data Storage and Security'>
          Your data is stored on Cloudflare's infrastructure including D1 (database), R2 (file
          storage), and KV (cache). We implement industry-standard security measures to protect your
          data. Social media tokens are stored encrypted and access is restricted to the minimum
          necessary.
        </Section>

        <Section title='7. Data Retention'>
          We retain your account data for as long as your account is active. Generated assets stored
          in R2 are retained until you delete them or close your account. Social account tokens are
          deleted immediately when you disconnect a social account.
        </Section>

        <Section title='8. Sharing of Information'>
          We do not sell, rent, or share your personal information with third parties except:
          <ul className='list-disc list-inside mt-2 space-y-1 text-gray-400'>
            <li>With AI providers (OpenAI, Replicate) to generate content you request</li>
            <li>With Clerk for authentication services</li>
            <li>With Instagram/TikTok APIs to publish content on your behalf</li>
            <li>When required by law or to protect our legal rights</li>
          </ul>
        </Section>

        <Section title='9. Your Rights'>
          You have the right to:
          <ul className='list-disc list-inside mt-2 space-y-1 text-gray-400'>
            <li>Access the personal data we hold about you</li>
            <li>Request correction of inaccurate data</li>
            <li>Request deletion of your account and associated data</li>
            <li>Disconnect social accounts and revoke publishing permissions at any time</li>
          </ul>
          To exercise these rights, contact us through the Service.
        </Section>

        <Section title='10. Cookies'>
          We use cookies and similar technologies only as required by our authentication provider
          (Clerk) to maintain your session. We do not use tracking or advertising cookies.
        </Section>

        <Section title='11. Children's Privacy'>
          The Service is not intended for users under the age of 13. We do not knowingly collect
          personal information from children under 13.
        </Section>

        <Section title='12. Changes to This Policy'>
          We may update this Privacy Policy from time to time. We will notify you of significant
          changes by updating the date at the top of this page. Continued use of the Service after
          changes constitutes acceptance of the updated policy.
        </Section>

        <Section title='13. Contact'>
          If you have questions or concerns about this Privacy Policy, please contact us through the
          support channels available in the Service.
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className='mb-8'>
      <h2 className='text-lg font-semibold text-white mb-3'>{title}</h2>
      <div className='text-gray-400 leading-relaxed text-sm'>{children}</div>
    </div>
  );
}
