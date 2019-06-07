package com.example.admin.bolar.tenantmain;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

import com.example.admin.bolar.CurrentScoreData.CurrentAge;
import com.example.admin.bolar.CurrentScoreData.CurrentAvgDuration;
import com.example.admin.bolar.CurrentScoreData.CurrentMarks;
import com.example.admin.bolar.CurrentScoreData.CurrentPaymentHist;
import com.example.admin.bolar.R;
import com.example.admin.bolar.ScoreBreakdown.AgeBreakdown;
import com.example.admin.bolar.signupflow.ConfirmationDetails;
import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.DocumentReference;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.QueryDocumentSnapshot;
import com.google.firebase.firestore.QuerySnapshot;

import java.util.Objects;

public class TenantHome extends AppCompatActivity {


    private FirebaseFirestore db = FirebaseFirestore.getInstance();
    private FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();

    private TextView AvgDurationState;
    private TextView AvgDurationLabel;
    private TextView ageState;
    private TextView ageLabel;
    private TextView payHistState;
    private TextView payHistLabel;
    private TextView marksState;
    private TextView marksLabel;

    private TextView currentScore;
    private ProgressBar scoreProgress;

    private Button ageButton;
    private Button payHistButton;
    private Button marksButton;
    private Button avgStayButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_tenant_home);

        AvgDurationState = findViewById(R.id.time_stayed_state_text);
        AvgDurationLabel = findViewById(R.id.avg_duration_label);
        ageState = findViewById(R.id.age_state_text);
        ageLabel = findViewById(R.id.age_label);
        payHistLabel = findViewById(R.id.payment_label);
        payHistState = findViewById(R.id.payment_state_text);
        marksLabel = findViewById(R.id.complaints_label);
        marksState = findViewById(R.id.complaints_state_text);

        currentScore = findViewById(R.id.current_score);
        scoreProgress = findViewById(R.id.score_progress_bar);

        ageButton = findViewById(R.id.age_button);
        payHistButton = findViewById(R.id.pay_hist_button);
        marksButton = findViewById(R.id.marks_button);
        avgStayButton = findViewById(R.id.avg_stay_button);

        setTitle("Score Overview");

        ageButton.setOnClickListener(new View.OnClickListener(){
            @Override
            public void onClick(View v){
                Intent intent = new Intent(TenantHome.this , AgeBreakdown.class);
                intent.putExtra("factor", "Age_History");
                TenantHome.this.startActivity(intent);
            }
        });
        payHistButton.setOnClickListener(new View.OnClickListener(){
            @Override
            public void onClick(View v){
                Intent intent = new Intent(TenantHome.this , AgeBreakdown.class);
                intent.putExtra("factor", "Payment_History");
                TenantHome.this.startActivity(intent);
            }
        });
        marksButton.setOnClickListener(new View.OnClickListener(){
            @Override
            public void onClick(View v){
                Intent intent = new Intent(TenantHome.this , AgeBreakdown.class);
                intent.putExtra("factor", "Marks_History");
                TenantHome.this.startActivity(intent);
            }
        });
        avgStayButton.setOnClickListener(new View.OnClickListener(){
            @Override
            public void onClick(View v){
                Intent intent = new Intent(TenantHome.this , AgeBreakdown.class);
                intent.putExtra("factor", "Average_Duration_History");
                TenantHome.this.startActivity(intent);
            }
        });


        getScoreData();
        setMainScore();
    }

    private void setMainScore() {
        DocumentReference docRef = db.collection("Tenant").document("PAt4FTo2zNX6fEfkcwhae3iJxrn1");
        docRef.get().addOnCompleteListener(new OnCompleteListener<DocumentSnapshot>() {

            private static final String TAG = "TAG";

            @Override
            public void onComplete(@NonNull Task<DocumentSnapshot> task) {
                if (task.isSuccessful()) {
                    DocumentSnapshot document = task.getResult();
                    if (document.exists()) {
                        Log.d(TAG, "DocumentSnapshot data: " + document.getData());
                        currentScore.setText(document.getDouble("currentScore").toString().substring(0,document.getDouble("currentScore").toString().length()-2));
                        scoreProgress.setProgress((int)(document.getDouble("currentScore")/10));
                    } else {
                        Log.d(TAG, "No such document");
                    }
                } else {
                    Log.d(TAG, "get failed with ", task.getException());
                }
            }
        });
    }

    public void getScoreData(){
        //TODO: replace hardcoded uid with user.getUid()
        db.collection("Tenant").document("PAt4FTo2zNX6fEfkcwhae3iJxrn1")
                .collection("Current_Score").get()
                .addOnCompleteListener(new OnCompleteListener<QuerySnapshot>() {

            private static final String TAG = "TAG";

            @Override
            public void onComplete(@NonNull Task<QuerySnapshot> task) {
                if (task.isSuccessful()) {
                    for (QueryDocumentSnapshot document : Objects.requireNonNull(task.getResult())) {
                        Log.d(TAG, document.getId() + " => " + document.getData());

                        if(document.getId().equals("Average_Duration")){
                            CurrentAvgDuration data = document.toObject(CurrentAvgDuration.class);
                            AvgDurationState.setText(data.getState());
                            if(data.getState().equals("Fair")){
                                AvgDurationLabel.setBackgroundColor(getResources().getColor(R.color.fair));
                                AvgDurationState.setBackgroundColor(getResources().getColor(R.color.fairState));
                            }
                            if(data.getState().equals("Okay")){
                                AvgDurationLabel.setBackgroundColor(getResources().getColor(R.color.okay));
                                AvgDurationState.setBackgroundColor(getResources().getColor(R.color.okayState));
                            }
                            if(data.getState().equals("Good")){
                                AvgDurationLabel.setBackgroundColor(getResources().getColor(R.color.good));
                                AvgDurationState.setBackgroundColor(getResources().getColor(R.color.goodState));
                            }
                            if(data.getState().equals("Pretty Good")){
                                AvgDurationLabel.setBackgroundColor(getResources().getColor(R.color.prettyGood));
                                AvgDurationState.setBackgroundColor(getResources().getColor(R.color.prettyGoodState));
                            }
                            if(data.getState().equals("Awesome")){
                                AvgDurationLabel.setBackgroundColor(getResources().getColor(R.color.awesome));
                                AvgDurationState.setBackgroundColor(getResources().getColor(R.color.awesomeState));
                            }
                        }else if(document.getId().equals("Marks")){
                            CurrentMarks data = document.toObject(CurrentMarks.class);
                            marksState.setText(data.getState());
                            if(data.getState().equals("Fair")){
                                marksLabel.setBackgroundColor(getResources().getColor(R.color.fair));
                                marksState.setBackgroundColor(getResources().getColor(R.color.fairState));
                            }
                            if(data.getState().equals("Okay")){
                                marksLabel.setBackgroundColor(getResources().getColor(R.color.okay));
                                marksState.setBackgroundColor(getResources().getColor(R.color.okayState));
                            }
                            if(data.getState().equals("Good")){
                                marksLabel.setBackgroundColor(getResources().getColor(R.color.good));
                                marksState.setBackgroundColor(getResources().getColor(R.color.goodState));
                            }
                            if(data.getState().equals("Pretty Good")){
                                marksLabel.setBackgroundColor(getResources().getColor(R.color.prettyGood));
                                marksState.setBackgroundColor(getResources().getColor(R.color.prettyGoodState));
                            }
                            if(data.getState().equals("Awesome")){
                                marksLabel.setBackgroundColor(getResources().getColor(R.color.awesome));
                                marksState.setBackgroundColor(getResources().getColor(R.color.awesomeState));
                            }
                        }else if(document.getId().equals("Overall_Age")){
                            CurrentAge data = document.toObject(CurrentAge.class);
                            ageState.setText(data.getState());
                            if(data.getState().equals("Fair")){
                                ageLabel.setBackgroundColor(getResources().getColor(R.color.fair));
                                ageState.setBackgroundColor(getResources().getColor(R.color.fairState));
                            }
                            if(data.getState().equals("Okay")){
                                ageLabel.setBackgroundColor(getResources().getColor(R.color.okay));
                                ageState.setBackgroundColor(getResources().getColor(R.color.okayState));
                            }
                            if(data.getState().equals("Good")){
                                ageLabel.setBackgroundColor(getResources().getColor(R.color.good));
                                ageState.setBackgroundColor(getResources().getColor(R.color.goodState));
                            }
                            if(data.getState().equals("Pretty Good")){
                                ageLabel.setBackgroundColor(getResources().getColor(R.color.prettyGood));
                                ageState.setBackgroundColor(getResources().getColor(R.color.prettyGoodState));
                            }
                            if(data.getState().equals("Awesome")){
                                ageLabel.setBackgroundColor(getResources().getColor(R.color.awesome));
                                ageState.setBackgroundColor(getResources().getColor(R.color.awesomeState));
                            }
                        }else if(document.getId().equals("Payment_History")){
                            CurrentPaymentHist data = document.toObject(CurrentPaymentHist.class);
                            payHistState.setText(data.getState());
                            if(data.getState().equals("Fair")){
                                payHistLabel.setBackgroundColor(getResources().getColor(R.color.fair));
                                payHistState.setBackgroundColor(getResources().getColor(R.color.fairState));
                            }
                            if(data.getState().equals("Okay")){
                                payHistLabel.setBackgroundColor(getResources().getColor(R.color.okay));
                                payHistState.setBackgroundColor(getResources().getColor(R.color.okayState));
                            }
                            if(data.getState().equals("Good")){
                                payHistLabel.setBackgroundColor(getResources().getColor(R.color.good));
                                payHistState.setBackgroundColor(getResources().getColor(R.color.goodState));
                            }
                            if(data.getState().equals("Pretty Good")){
                                payHistLabel.setBackgroundColor(getResources().getColor(R.color.prettyGood));
                                payHistState.setBackgroundColor(getResources().getColor(R.color.prettyGoodState));
                            }
                            if(data.getState().equals("Awesome")){
                                payHistLabel.setBackgroundColor(getResources().getColor(R.color.awesome));
                                payHistState.setBackgroundColor(getResources().getColor(R.color.awesomeState));
                            }
                        }
                    }

//                    DocumentSnapshot document = task.getResult();
//                    assert document != null;
//                    if (document.exists()) {
//                        Log.d(TAG, "DocumentSnapshot data: " + document.getData());
//                        CurrentAvgDuration data = document.toObject(CurrentAvgDuration.class);
//                        AvgDurationState.setText(data.getState());
//                    } else {
//                        Log.d(TAG, "No such document");
//                    }
                } else {
                    Log.d(TAG, "get failed with ", task.getException());
                }
            }
        });
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
                Intent intent = new Intent(TenantHome.this , New_Application.class);
                TenantHome.this.startActivity(intent);
            case R.id.tenant_pending_applications:
                Toast.makeText(this, "Pending Application Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_settings:
                Toast.makeText(this, "Settings Menu Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_account_settings:
                Toast.makeText(this, "Account Settings Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_bank_settings:
                Toast.makeText(this, "Bank Settings Selected", Toast.LENGTH_SHORT).show();
                Intent intent1 = new Intent(TenantHome.this , TenantStripeTest.class);
                TenantHome.this.startActivity(intent1);
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
