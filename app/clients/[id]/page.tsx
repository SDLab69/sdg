import HouseholdProfile from "../../components/HouseholdProfile";

export default function ProfilePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { from?: string };
}) {
  return (
    <HouseholdProfile
      id={params.id}
      from={(searchParams.from as "calendar" | "clients" | "adhoc") ?? "clients"}
    />
  );
}
