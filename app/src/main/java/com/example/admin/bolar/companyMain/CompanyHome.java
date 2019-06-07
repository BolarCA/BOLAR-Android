package com.example.admin.bolar.companyMain;

import androidx.appcompat.app.AppCompatActivity;

import android.content.Intent;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.widget.Toast;

import com.example.admin.bolar.R;
import com.example.admin.bolar.tenantmain.New_Application;
import com.example.admin.bolar.tenantmain.TenantHome;

public class CompanyHome extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_company_home);
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        MenuInflater inflator = getMenuInflater();
        inflator.inflate(R.menu.tenant_menu, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {

        switch(item.getItemId()){
            case R.id.tenant_application:
                Toast.makeText(this, "Application Menu Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_new_application:
                Toast.makeText(this, "New Application Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_pending_applications:
                Toast.makeText(this, "Pending Application Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_settings:
                Toast.makeText(this, "Settings Menu Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_account_settings:
                Toast.makeText(this, "Account Settings Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_bank_settings:
                Toast.makeText(this, "Bank Settings Selected", Toast.LENGTH_SHORT).show();
                Intent intent = new Intent(CompanyHome.this , BankSettingsCompany.class);
                CompanyHome.this.startActivity(intent);
            case R.id.tenant_customer_support:
                Toast.makeText(this, "Customer Support Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_log_out:
                Toast.makeText(this, "Log Out Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_score_history:
                Toast.makeText(this, "Score History Selected", Toast.LENGTH_SHORT).show();
            default:
                return super.onOptionsItemSelected(item);
        }
    }
}
